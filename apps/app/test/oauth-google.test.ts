import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { GoogleOAuth, decodeIdToken, encryptSecret, decryptSecret } from "../src/index.ts";
import type { FetchFn } from "@gsc/gsc-client";

/** Baut ein (unsigniertes) JWT mit gegebener Payload. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signatur`;
}

describe("decodeIdToken", () => {
  it("liest sub und email aus der Payload", () => {
    const token = jwt({ sub: "115...", email: "a@b.de", extra: 1 });
    expect(decodeIdToken(token)).toEqual({ sub: "115...", email: "a@b.de" });
  });
  it("wirft bei fehlerhaftem JWT", () => {
    expect(() => decodeIdToken("kein.jwt")).toThrow();
  });
});

describe("GoogleOAuth.authorizeUrl", () => {
  const g = new GoogleOAuth({
    clientId: "cid",
    clientSecret: "sec",
    redirectUri: "https://gsc2mcp.drossmedia.de/oauth/google/callback",
  });

  it("baut die Consent-URL mit offline/consent und Scopes", () => {
    const url = new URL(g.authorizeUrl("state-1", ["openid", "email", "webmasters.readonly"]));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toBe("openid email webmasters.readonly");
  });
});

describe("GoogleOAuth.exchange", () => {
  function fetchReturning(status: number, payload: unknown): { fetchFn: FetchFn; seen: { url?: string; body?: string } } {
    const seen: { url?: string; body?: string } = {};
    const fetchFn: FetchFn = async (url, init) => {
      seen.url = url;
      seen.body = init.body;
      return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
    };
    return { fetchFn, seen };
  }

  it("tauscht den Code gegen Identität und Refresh-Token", async () => {
    const { fetchFn, seen } = fetchReturning(200, {
      access_token: "ya29...",
      refresh_token: "1//refresh",
      id_token: jwt({ sub: "sub-9", email: "seo@aip.aero" }),
      scope: "openid email https://www.googleapis.com/auth/webmasters.readonly",
    });
    const g = new GoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb", fetchFn });
    const identity = await g.exchange("auth-code");

    expect(identity.googleSub).toBe("sub-9");
    expect(identity.email).toBe("seo@aip.aero");
    expect(identity.refreshToken).toBe("1//refresh");
    expect(identity.scopes).toContain("https://www.googleapis.com/auth/webmasters.readonly");
    // Form-kodierter Body an den Token-Endpunkt.
    expect(seen.url).toBe("https://oauth2.googleapis.com/token");
    expect(seen.body).toContain("grant_type=authorization_code");
    expect(seen.body).toContain("code=auth-code");
  });

  it("wirft bei Fehlerstatus", async () => {
    const { fetchFn } = fetchReturning(400, { error: "invalid_grant" });
    const g = new GoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb", fetchFn });
    await expect(g.exchange("bad")).rejects.toThrow();
  });

  it("wirft ohne id_token", async () => {
    const { fetchFn } = fetchReturning(200, { access_token: "a", scope: "openid" });
    const g = new GoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb", fetchFn });
    await expect(g.exchange("code")).rejects.toThrow();
  });
});

describe("AES-256-GCM (Refresh-Token-Verschlüsselung)", () => {
  const key = randomBytes(32);

  it("Roundtrip: entschlüsselt zum Klartext", () => {
    const blob = encryptSecret("1//sehr-geheim", key);
    expect(blob.length).toBeGreaterThan(28); // iv(12) + tag(16) + Inhalt
    expect(decryptSecret(blob, key)).toBe("1//sehr-geheim");
  });

  it("erkennt Manipulation (GCM-Tag)", () => {
    const blob = encryptSecret("geheim", key);
    blob[blob.length - 1] ^= 0xff; // Tag verfälschen
    expect(() => decryptSecret(blob, key)).toThrow();
  });

  it("scheitert mit falschem Schlüssel", () => {
    const blob = encryptSecret("geheim", key);
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
  });

  it("verlangt einen 32-Byte-Schlüssel", () => {
    expect(() => encryptSecret("x", randomBytes(16))).toThrow();
  });
});
