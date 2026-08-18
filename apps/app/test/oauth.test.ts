import { describe, it, expect } from "vitest";
import {
  computeChallenge,
  verifyPkce,
  authorizationServerMetadata,
  protectedResourceMetadata,
  registerClient,
  isValidRedirectUri,
  makeBearerAuthenticator,
  InMemoryClientStore,
  InMemoryTokenStore,
  type AccessGrant,
} from "../src/index.ts";

describe("PKCE", () => {
  it("S256: Verifier passt zur errechneten Challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = computeChallenge(verifier, "S256");
    expect(challenge).not.toBe(verifier); // gehasht
    expect(verifyPkce(verifier, challenge, "S256")).toBe(true);
    expect(verifyPkce("falsch", challenge, "S256")).toBe(false);
  });

  it("plain: Challenge ist der Verifier", () => {
    expect(computeChallenge("abc", "plain")).toBe("abc");
    expect(verifyPkce("abc", "abc", "plain")).toBe(true);
  });

  it("bekannter RFC-7636-Testvektor", () => {
    // Anhang B der RFC.
    expect(computeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "S256")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("Metadaten", () => {
  it("AS-Metadata trägt Endpunkte und PKCE-Pflicht", () => {
    const m = authorizationServerMetadata({
      issuer: "https://gsc2mcp.drossmedia.de/",
      scopesSupported: ["mcp"],
    });
    expect(m.issuer).toBe("https://gsc2mcp.drossmedia.de"); // Schrägstrich normalisiert
    expect(m.authorization_endpoint).toBe("https://gsc2mcp.drossmedia.de/authorize");
    expect(m.registration_endpoint).toBe("https://gsc2mcp.drossmedia.de/register");
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("Protected-Resource-Metadata verweist auf den AS", () => {
    const m = protectedResourceMetadata({
      resource: "https://gsc2mcp.drossmedia.de/mcp",
      authorizationServers: ["https://gsc2mcp.drossmedia.de"],
      scopesSupported: ["mcp"],
    });
    expect(m.resource).toBe("https://gsc2mcp.drossmedia.de/mcp");
    expect(m.authorization_servers).toEqual(["https://gsc2mcp.drossmedia.de"]);
  });
});

describe("isValidRedirectUri", () => {
  it("akzeptiert https und http-Loopback, lehnt Rest ab", () => {
    expect(isValidRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:8080/cb")).toBe(true);
    expect(isValidRedirectUri("http://example.com/cb")).toBe(false); // http, nicht Loopback
    expect(isValidRedirectUri("https://x/cb#frag")).toBe(false); // Fragment
    expect(isValidRedirectUri("nonsense")).toBe(false);
  });
});

describe("Dynamic Client Registration", () => {
  const deps = () => {
    let n = 0;
    return {
      store: new InMemoryClientStore(),
      newClientId: () => `client-${++n}`,
      newClientSecret: () => "s3cr3t",
      now: () => 1_700_000_000_000,
    };
  };

  it("öffentlicher Client (PKCE) bekommt kein Secret", async () => {
    const d = deps();
    const res = await registerClient(
      { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" },
      d,
    );
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBe("client-1");
    expect(res.body.client_secret).toBeUndefined();
    expect(res.body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(await d.store.get("client-1")).toBeDefined();
  });

  it("vertraulicher Client bekommt ein Secret", async () => {
    const res = await registerClient(
      { redirect_uris: ["https://app.example.com/cb"], token_endpoint_auth_method: "client_secret_basic" },
      deps(),
    );
    expect(res.body.client_secret).toBe("s3cr3t");
  });

  it("lehnt fehlende und ungültige redirect_uris ab", async () => {
    expect((await registerClient({}, deps())).status).toBe(400);
    expect((await registerClient({ redirect_uris: ["http://evil.com/cb"] }, deps())).status).toBe(400);
  });
});

describe("Bearer-Authentifikator", () => {
  const grant = (over: Partial<AccessGrant> = {}): AccessGrant => ({
    token: "tok-1",
    userId: 42,
    scope: "mcp",
    audience: "https://gsc2mcp.drossmedia.de/mcp",
    expiresAt: 2_000_000_000_000,
    ...over,
  });

  async function auth(store: InMemoryTokenStore, header?: string, audience?: string) {
    const authenticator = makeBearerAuthenticator({
      tokenStore: store,
      resolvePlan: async () => "pro",
      ...(audience === undefined ? {} : { audience }),
      now: () => 1_700_000_000_000,
    });
    return authenticator(header === undefined ? {} : { authorization: header });
  }

  it("gültiges Token → Session mit aufgelöstem Plan", async () => {
    const store = new InMemoryTokenStore();
    await store.saveAccess(grant());
    const session = await auth(store, "Bearer tok-1", "https://gsc2mcp.drossmedia.de/mcp");
    expect(session).toEqual({ plan: "pro", userId: 42 });
  });

  it("fehlender Header oder unbekanntes Token → null", async () => {
    const store = new InMemoryTokenStore();
    expect(await auth(store, undefined)).toBeNull();
    expect(await auth(store, "Bearer gibt-es-nicht")).toBeNull();
    expect(await auth(store, "Basic abc")).toBeNull();
  });

  it("abgelaufenes Token → null", async () => {
    const store = new InMemoryTokenStore();
    await store.saveAccess(grant({ expiresAt: 1_600_000_000_000 })); // vor now
    expect(await auth(store, "Bearer tok-1")).toBeNull();
  });

  it("falsche Zielressource → null (RFC 8707)", async () => {
    const store = new InMemoryTokenStore();
    await store.saveAccess(grant({ audience: "https://anderer-server/mcp" }));
    expect(await auth(store, "Bearer tok-1", "https://gsc2mcp.drossmedia.de/mcp")).toBeNull();
  });
});
