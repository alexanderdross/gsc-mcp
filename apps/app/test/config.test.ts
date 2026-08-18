import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/index.ts";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const base: Record<string, string> = {
  ISSUER: "https://gsc2mcp.drossmedia.de/",
  DATABASE_URL: "postgres://u:p@h:5432/db",
  ENCRYPTION_KEY: KEY_B64,
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "sec",
};

describe("loadConfig", () => {
  it("normalisiert issuer/resource und setzt Vorgaben", () => {
    const c = loadConfig(base);
    expect(c.issuer).toBe("https://gsc2mcp.drossmedia.de"); // Schrägstrich entfernt
    expect(c.resource).toBe("https://gsc2mcp.drossmedia.de/mcp");
    expect(c.port).toBe(8080);
    expect(c.google.redirectUri).toBe("https://gsc2mcp.drossmedia.de/oauth/google/callback");
    expect(c.googleScopes).toContain("https://www.googleapis.com/auth/webmasters.readonly");
    expect(c.encryptionKey.length).toBe(32);
  });

  it("respektiert PORT, GOOGLE_REDIRECT_URI und GOOGLE_SCOPES", () => {
    const c = loadConfig({
      ...base,
      PORT: "9000",
      GOOGLE_REDIRECT_URI: "https://x/cb",
      GOOGLE_SCOPES: "openid email",
    });
    expect(c.port).toBe(9000);
    expect(c.google.redirectUri).toBe("https://x/cb");
    expect(c.googleScopes).toEqual(["openid", "email"]);
  });

  it("akzeptiert einen hex-Schlüssel", () => {
    const c = loadConfig({ ...base, ENCRYPTION_KEY: "aa".repeat(32) });
    expect(c.encryptionKey.length).toBe(32);
  });

  it("wirft bei fehlender Pflichtvariable und falschem Schlüssel", () => {
    const { ISSUER: _unused, ...noIssuer } = base;
    expect(() => loadConfig(noIssuer)).toThrow(/ISSUER/);
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow();
  });
});
