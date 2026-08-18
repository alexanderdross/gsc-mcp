import { describe, it, expect } from "vitest";
import {
  HttpRouter,
  McpServer,
  McpEndpoint,
  InMemorySessionStore,
  Router,
  buildRegistry,
  OAuthProvider,
  InMemoryClientStore,
  InMemoryTokenStore,
  InMemoryAuthCodeStore,
  InMemoryPendingStore,
  makeBearerAuthenticator,
  authorizationServerMetadata,
  protectedResourceMetadata,
  computeChallenge,
  type HttpRequest,
  type OAuthGenerators,
  type GoogleAuth,
  type UserDirectory,
} from "../src/index.ts";

const ISSUER = "https://gsc2mcp.drossmedia.de";
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = computeChallenge(VERIFIER, "S256");

function gens(): OAuthGenerators {
  let s = 0;
  let c = 0;
  let a = 0;
  let r = 0;
  return {
    state: () => `state-${++s}`,
    authCode: () => `code-${++c}`,
    accessToken: () => `access-${++a}`,
    refreshToken: () => `refresh-${++r}`,
  };
}

const google: GoogleAuth = {
  authorizeUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  exchange: async () => ({ googleSub: "sub-9", email: "a@b.de", refreshToken: "g", scopes: ["webmasters.readonly"] }),
};
const users: UserDirectory = { linkGoogle: async () => ({ userId: 7 }) };

function makeRouter() {
  const clients = new InMemoryClientStore();
  const tokens = new InMemoryTokenStore();
  const provider = new OAuthProvider({
    clients,
    codes: new InMemoryAuthCodeStore(),
    tokens,
    pending: new InMemoryPendingStore(),
    users,
    google,
    gen: gens(),
    googleScopes: ["openid", "email", "webmasters.readonly"],
    now: () => 1_700_000_000_000,
  });
  const mcp = new McpEndpoint({
    server: new McpServer(buildRegistry(), new Router(buildRegistry(), { ownershipCheck: async () => true })),
    store: new InMemorySessionStore(() => "sess-1"),
    authenticate: makeBearerAuthenticator({
      tokenStore: tokens,
      resolvePlan: async () => "pro",
      audience: RESOURCE,
      now: () => 1_700_000_000_000,
    }),
  });
  const router = new HttpRouter({
    mcp,
    provider,
    registration: {
      store: clients,
      newClientId: () => "client-1",
      newClientSecret: () => "secret",
      now: () => 0,
    },
    metadata: {
      authorizationServer: authorizationServerMetadata({ issuer: ISSUER, scopesSupported: ["mcp"] }),
      protectedResource: protectedResourceMetadata({
        resource: RESOURCE,
        authorizationServers: [ISSUER],
        scopesSupported: ["mcp"],
      }),
    },
  });
  return router;
}

function req(over: Partial<HttpRequest>): HttpRequest {
  return { method: "GET", path: "/", query: {}, headers: {}, body: "", ...over };
}

describe("HttpRouter — Metadaten und Fehler", () => {
  const router = makeRouter();

  it("liefert AS-Metadaten", async () => {
    const res = await router.handle(req({ path: "/.well-known/oauth-authorization-server" }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).issuer).toBe(ISSUER);
  });

  it("liefert Protected-Resource-Metadaten", async () => {
    const res = await router.handle(req({ path: "/.well-known/oauth-protected-resource" }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).resource).toBe(RESOURCE);
  });

  it("unbekannter Pfad → 404", async () => {
    const res = await router.handle(req({ path: "/gibt-es-nicht" }));
    expect(res.status).toBe(404);
  });

  it("nicht erlaubte Methode auf /mcp → 405", async () => {
    const res = await router.handle(req({ method: "GET", path: "/mcp" }));
    expect(res.status).toBe(405);
  });
});

describe("HttpRouter — voller OAuth-Fluss über HTTP bis zum MCP", () => {
  it("register → authorize → callback → token → /mcp initialize", async () => {
    const router = makeRouter();

    // 1. DCR
    const reg = await router.handle(
      req({
        method: "POST",
        path: "/register",
        body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
      }),
    );
    expect(reg.status).toBe(201);
    expect(JSON.parse(reg.body).client_id).toBe("client-1");

    // 2. authorize → 302 zu Google
    const auth = await router.handle(
      req({
        path: "/authorize",
        query: {
          response_type: "code",
          client_id: "client-1",
          redirect_uri: REDIRECT,
          code_challenge: CHALLENGE,
          code_challenge_method: "S256",
          state: "client-xyz",
          resource: RESOURCE,
        },
      }),
    );
    expect(auth.status).toBe(302);
    expect(auth.headers.location).toContain("accounts.google.com");

    // 3. Google-Rückkanal → 302 zum Client mit code
    const cb = await router.handle(
      req({ path: "/oauth/google/callback", query: { state: "state-1", code: "g-code" } }),
    );
    expect(cb.status).toBe(302);
    const cbUrl = new URL(cb.headers.location!);
    expect(cbUrl.searchParams.get("code")).toBe("code-1");
    expect(cbUrl.searchParams.get("state")).toBe("client-xyz");

    // 4. token
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: REDIRECT,
      client_id: "client-1",
      code_verifier: VERIFIER,
    }).toString();
    const tok = await router.handle(req({ method: "POST", path: "/token", body: tokenBody }));
    expect(tok.status).toBe(200);
    const token = JSON.parse(tok.body);
    expect(token.access_token).toBe("access-1");
    expect(token.token_type).toBe("Bearer");

    // 5. /mcp initialize mit dem Bearer-Token
    const init = await router.handle(
      req({
        method: "POST",
        path: "/mcp",
        headers: { authorization: `Bearer ${token.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(init.status).toBe(200);
    expect(init.headers["mcp-session-id"]).toBe("sess-1");
    expect(JSON.parse(init.body).result.serverInfo.name).toBe("gsc-mcp");

    // 6. Folgeaufruf mit Session-Id: tools/list
    const list = await router.handle(
      req({
        method: "POST",
        path: "/mcp",
        headers: { "mcp-session-id": "sess-1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      }),
    );
    expect(list.status).toBe(200);
    expect(JSON.parse(list.body).result.tools.length).toBeGreaterThan(0);

    // 7. DELETE /mcp beendet die Sitzung
    const del = await router.handle(req({ method: "DELETE", path: "/mcp", headers: { "mcp-session-id": "sess-1" } }));
    expect(del.status).toBe(204);
  });

  it("/mcp ohne gültigen Bearer beim initialize → 401", async () => {
    const router = makeRouter();
    const res = await router.handle(
      req({
        method: "POST",
        path: "/mcp",
        headers: { authorization: "Bearer ungueltig" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
