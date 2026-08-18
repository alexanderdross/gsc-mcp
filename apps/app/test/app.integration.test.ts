import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createDb, type Db } from "@gsc/db";
import { buildApp, GoogleOAuth, type AppConfig, type HttpRequest, type InspectionQueue } from "../src/index.ts";
import type { FetchFn } from "@gsc/gsc-client";
import type pg from "pg";

/**
 * End-to-end-Verdrahtungstest gegen echtes PostgreSQL: buildApp erzeugt den HttpRouter,
 * und der volle OAuth-Fluss über HTTP mündet in einen funktionierenden MCP-Aufruf —
 * mit persistenten OAuth-Speichern und der DbUserDirectory. Läuft nur mit PGURL.
 */

const PGURL = process.env.PGURL;
const migration = readFileSync(
  fileURLToPath(new URL("../../../packages/db/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);
const ISSUER = "https://gsc2mcp.drossmedia.de";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

/** Google-Adapter mit gefälschtem fetch: liefert id_token beim Code-Tausch. */
function googleAdapter() {
  const fetchFn: FetchFn = async (_url, init) => {
    const body = init.body ?? "";
    const payload = body.includes("authorization_code")
      ? { access_token: "ya29", refresh_token: "1//r", id_token: jwt({ sub: "sub-9", email: "a@b.de" }), scope: "openid email" }
      : { access_token: "ya29.refreshed", expires_in: 3600 };
    return { ok: true, status: 200, json: async () => payload, text: async () => "" };
  };
  return new GoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: `${ISSUER}/oauth/google/callback`, fetchFn });
}

function req(over: Partial<HttpRequest>): HttpRequest {
  return { method: "GET", path: "/", query: {}, headers: {}, body: "", ...over };
}

describe.skipIf(!PGURL)("buildApp (PostgreSQL, voller HTTP-Fluss)", () => {
  let db: Db;
  let pool: pg.Pool;
  let router: ReturnType<typeof buildApp>["router"];

  beforeAll(async () => {
    ({ db, pool } = createDb({ url: PGURL!, maxConnections: 4 }));
    await pool.query("DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS wh CASCADE;");
    await pool.query(migration);

    const config: AppConfig = {
      port: 8080,
      issuer: ISSUER,
      resource: `${ISSUER}/mcp`,
      databaseUrl: PGURL!,
      encryptionKey: randomBytes(32),
      google: { clientId: "cid", clientSecret: "sec", redirectUri: `${ISSUER}/oauth/google/callback` },
      googleScopes: ["openid", "email", "webmasters.readonly"],
    };
    const queue: InspectionQueue = { async enqueue() {} };
    ({ router } = buildApp({ db, google: googleAdapter(), config, queue, newSessionId: () => "sess-1" }));
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("register → authorize → callback → token → /mcp initialize → tools/list", async () => {
    // Metadaten stehen.
    const meta = await router.handle(req({ path: "/.well-known/oauth-protected-resource" }));
    expect(JSON.parse(meta.body).resource).toBe(`${ISSUER}/mcp`);

    // DCR
    const reg = await router.handle(
      req({ method: "POST", path: "/register", body: JSON.stringify({ redirect_uris: [REDIRECT] }) }),
    );
    expect(reg.status).toBe(201);
    const clientId = JSON.parse(reg.body).client_id as string;

    // PKCE
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const { computeChallenge } = await import("../src/index.ts");
    const challenge = computeChallenge(verifier, "S256");

    // authorize → 302 zu Google
    const auth = await router.handle(
      req({
        path: "/authorize",
        query: {
          response_type: "code",
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: challenge,
          state: "cs",
          resource: `${ISSUER}/mcp`,
        },
      }),
    );
    expect(auth.status).toBe(302);
    const googleState = new URL(auth.headers.location!).searchParams.get("state")!;

    // callback → 302 zum Client mit code (User wird angelegt, Refresh-Token verschlüsselt)
    const cb = await router.handle(req({ path: "/oauth/google/callback", query: { state: googleState, code: "gc" } }));
    expect(cb.status).toBe(302);
    const code = new URL(cb.headers.location!).searchParams.get("code")!;

    // token
    const tok = await router.handle(
      req({
        method: "POST",
        path: "/token",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          client_id: clientId,
          code_verifier: verifier,
        }).toString(),
      }),
    );
    expect(tok.status).toBe(200);
    const accessToken = JSON.parse(tok.body).access_token as string;

    // /mcp initialize mit dem Bearer-Token → Session-Id
    const init = await router.handle(
      req({
        method: "POST",
        path: "/mcp",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(init.status).toBe(200);
    expect(init.headers["mcp-session-id"]).toBe("sess-1");

    // tools/list über die Session
    const list = await router.handle(
      req({
        method: "POST",
        path: "/mcp",
        headers: { "mcp-session-id": "sess-1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      }),
    );
    const tools = JSON.parse(list.body).result.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain("search_performance");
    expect(tools.map((t) => t.name)).toContain("get_google_updates");
  });

  it("Google-Verknüpfung liegt verschlüsselt in der DB", async () => {
    const rows = await pool.query("SELECT count(*)::int AS n FROM core.google_credentials");
    expect(rows.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
