import { describe, it, expect } from "vitest";
import {
  OAuthProvider,
  makeBearerAuthenticator,
  computeChallenge,
  InMemoryClientStore,
  InMemoryTokenStore,
  InMemoryAuthCodeStore,
  InMemoryPendingStore,
  type OAuthGenerators,
  type GoogleAuth,
  type UserDirectory,
  type OAuthClient,
} from "../src/index.ts";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = "https://gsc2mcp.drossmedia.de/mcp";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = computeChallenge(VERIFIER, "S256");

function client(over: Partial<OAuthClient> = {}): OAuthClient {
  return {
    clientId: "client-1",
    redirectUris: [REDIRECT],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    createdAt: 0,
    ...over,
  };
}

/** Deterministische Generatoren: durchnummeriert. */
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
  authorizeUrl: (state, scopes) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&scope=${encodeURIComponent(scopes.join(" "))}`,
  exchange: async () => ({ googleSub: "sub-9", email: "a@b.de", refreshToken: "g-refresh", scopes: ["webmasters.readonly"] }),
};

const users: UserDirectory = { linkGoogle: async () => ({ userId: 42 }) };

function provider(over: Partial<Parameters<typeof makeProvider>[0]> = {}) {
  return makeProvider(over);
}

function makeProvider(over: {
  clients?: InMemoryClientStore;
  tokens?: InMemoryTokenStore;
  now?: () => number;
  googleAuth?: GoogleAuth;
} = {}) {
  const clients = over.clients ?? new InMemoryClientStore();
  const tokens = over.tokens ?? new InMemoryTokenStore();
  const codes = new InMemoryAuthCodeStore();
  const pending = new InMemoryPendingStore();
  const p = new OAuthProvider({
    clients,
    codes,
    tokens,
    pending,
    users,
    google: over.googleAuth ?? google,
    gen: gens(),
    googleScopes: ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"],
    now: over.now ?? (() => 1_700_000_000_000),
  });
  return { p, clients, tokens, codes, pending };
}

async function seedClient(clients: InMemoryClientStore, over: Partial<OAuthClient> = {}) {
  await clients.save(client(over));
}

describe("OAuthProvider.authorize", () => {
  it("leitet nach Validierung zur Google-Zustimmung weiter", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients);
    const res = await p.authorize({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      scope: "mcp",
      state: "client-xyz",
      resource: RESOURCE,
    });
    expect(res.kind).toBe("redirect");
    if (res.kind !== "redirect") return;
    expect(res.location).toContain("accounts.google.com");
    expect(res.location).toContain("state=state-1");
  });

  it("lehnt unbekannte redirect_uri hart ab (kein Redirect)", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients);
    const res = await p.authorize({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://evil.example/cb",
      code_challenge: CHALLENGE,
    });
    expect(res.kind).toBe("error");
  });

  it("meldet PKCE-Pflicht als Fehler-Redirect an den Client", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients);
    const res = await p.authorize({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: REDIRECT,
      state: "client-xyz",
    });
    expect(res.kind).toBe("error_redirect");
    if (res.kind !== "error_redirect") return;
    expect(res.location).toContain("error=invalid_request");
    expect(res.location).toContain("state=client-xyz");
  });
});

describe("OAuthProvider — voller Fluss authorize → callback → token", () => {
  it("liefert Access- und Refresh-Token; das Access-Token authentifiziert am MCP", async () => {
    const { p, clients, tokens } = makeProvider();
    await seedClient(clients);

    // 1. authorize → Google
    await p.authorize({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      state: "client-xyz",
      resource: RESOURCE,
    });

    // 2. Google-Rückkanal → unser code, Redirect zum Client
    const cb = await p.googleCallback({ state: "state-1", code: "google-code" });
    expect(cb.kind).toBe("redirect");
    if (cb.kind !== "redirect") return;
    const cbUrl = new URL(cb.location);
    expect(cbUrl.searchParams.get("code")).toBe("code-1");
    expect(cbUrl.searchParams.get("state")).toBe("client-xyz");

    // 3. token (authorization_code) mit PKCE-Verifier
    const tok = await p.token({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: REDIRECT,
      client_id: "client-1",
      code_verifier: VERIFIER,
    });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toBe("access-1");
    expect(tok.body.refresh_token).toBe("refresh-1");
    expect(tok.body.token_type).toBe("Bearer");

    // Das Token authentifiziert am MCP-Transport, mit korrekter Zielressource.
    const authenticator = makeBearerAuthenticator({
      tokenStore: tokens,
      resolvePlan: async () => "pro",
      audience: RESOURCE,
      now: () => 1_700_000_000_000,
    });
    expect(await authenticator({ authorization: "Bearer access-1" })).toEqual({ plan: "pro", userId: 42 });
  });

  it("verweigert den Code bei falschem PKCE-Verifier", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients);
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE });
    await p.googleCallback({ state: "state-1", code: "google-code" });
    const tok = await p.token({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: REDIRECT,
      client_id: "client-1",
      code_verifier: "falscher-verifier",
    });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe("invalid_grant");
  });

  it("Code ist einmalig einlösbar", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients);
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE });
    await p.googleCallback({ state: "state-1", code: "google-code" });
    const first = await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });
    expect(first.status).toBe(200);
    const second = await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");
  });

  it("refresh_token rotiert: alter Refresh wird ungültig, neuer gilt", async () => {
    const { p, clients, tokens } = makeProvider();
    await seedClient(clients);
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE });
    await p.googleCallback({ state: "state-1", code: "google-code" });
    await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });

    const refreshed = await p.token({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "client-1" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toBe("access-2");
    expect(refreshed.body.refresh_token).toBe("refresh-2");
    expect(await tokens.getRefresh("refresh-1")).toBeUndefined(); // rotiert/entwertet

    const reuse = await p.token({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    expect(reuse.status).toBe(400);
  });

  it("vertraulicher Client braucht am /token sein Secret", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients, { tokenEndpointAuthMethod: "client_secret_basic", clientSecret: "s3cr3t" });
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE });
    await p.googleCallback({ state: "state-1", code: "google-code" });

    // Ohne Secret → 401, ohne den Code zu verbrauchen (Client-Auth läuft zuerst).
    const noSecret = await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });
    expect(noSecret.status).toBe(401);
    expect(noSecret.body.error).toBe("invalid_client");

    // Derselbe Code gilt noch — mit Secret klappt es.
    const withSecret = await p.token({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: REDIRECT,
      client_id: "client-1",
      code_verifier: VERIFIER,
      client_secret: "s3cr3t",
    });
    expect(withSecret.status).toBe(200);
  });

  it("callback mit Google-Fehler leitet den Fehler an den Client zurück", async () => {
    const { p, clients } = makeProvider();
    await seedClient(clients);
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE, state: "client-xyz" });
    const cb = await p.googleCallback({ state: "state-1", error: "access_denied" });
    expect(cb.kind).toBe("redirect");
    if (cb.kind !== "redirect") return;
    expect(cb.location).toContain("error=access_denied");
    expect(cb.location).toContain("state=client-xyz");
  });

  it("unbekannter state im callback → 400", async () => {
    const { p } = makeProvider();
    const cb = await p.googleCallback({ state: "gibt-es-nicht", code: "x" });
    expect(cb.kind).toBe("error");
  });
});
