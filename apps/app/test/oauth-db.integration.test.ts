import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createDb, schema, type Db } from "@gsc/db";
import { eq } from "drizzle-orm";
import {
  OAuthProvider,
  DbClientStore,
  DbTokenStore,
  DbAuthCodeStore,
  DbPendingStore,
  DbUserDirectory,
  makeBearerAuthenticator,
  computeChallenge,
  decryptSecret,
  registerClient,
  type GoogleAuth,
  type OAuthGenerators,
} from "../src/index.ts";
import type pg from "pg";

/**
 * End-to-end gegen echtes PostgreSQL: die persistenten OAuth-Speicher und das
 * UserDirectory im vollen Fluss authorize → callback → token, plus die verschlüsselte
 * Ablage des Google-Refresh-Tokens. Läuft nur mit PGURL (CI-Job „DDL gegen PostgreSQL").
 */

const PGURL = process.env.PGURL;
const migration = readFileSync(
  fileURLToPath(new URL("../../../packages/db/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = "https://gsc2mcp.drossmedia.de/mcp";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = computeChallenge(VERIFIER, "S256");
const KEY = randomBytes(32);

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
  exchange: async () => ({ googleSub: "sub-9", email: "seo@aip.aero", refreshToken: "1//g-refresh", scopes: ["webmasters.readonly"] }),
};

describe.skipIf(!PGURL)("OAuth-Persistenz (PostgreSQL)", () => {
  let db: Db;
  let pool: pg.Pool;
  let tokens: DbTokenStore;
  let clients: DbClientStore;

  function newProvider() {
    return new OAuthProvider({
      clients,
      codes: new DbAuthCodeStore(db),
      tokens,
      pending: new DbPendingStore(db),
      users: new DbUserDirectory({ db, encryptionKey: KEY }),
      google,
      gen: gens(),
      googleScopes: ["openid", "email", "webmasters.readonly"],
      now: () => 1_700_000_000_000,
    });
  }

  beforeAll(async () => {
    ({ db, pool } = createDb({ url: PGURL!, maxConnections: 4 }));
    await pool.query("DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS wh CASCADE;");
    await pool.query(migration);
    clients = new DbClientStore(db);
    tokens = new DbTokenStore(db);
    // Client via DCR registrieren und persistieren.
    const reg = await registerClient(
      { redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
      { store: clients, newClientId: () => "client-1", newClientSecret: () => "x", now: () => 0 },
    );
    expect(reg.status).toBe(201);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("DbClientStore persistiert und liest den Client", async () => {
    const c = await clients.get("client-1");
    expect(c?.redirectUris).toEqual([REDIRECT]);
    expect(c?.tokenEndpointAuthMethod).toBe("none");
    expect(c?.clientSecret).toBeUndefined();
  });

  it("voller Fluss: authorize → callback → token, Token in der DB, Auth am MCP", async () => {
    const p = newProvider();
    await p.authorize({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      state: "client-xyz",
      resource: RESOURCE,
    });
    const cb = await p.googleCallback({ state: "state-1", code: "google-code" });
    expect(cb.kind).toBe("redirect");
    if (cb.kind !== "redirect") return;
    expect(new URL(cb.location).searchParams.get("code")).toBe("code-1");

    const tok = await p.token({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: REDIRECT,
      client_id: "client-1",
      code_verifier: VERIFIER,
    });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toBe("access-1");

    // Access-Token liegt in der DB und authentifiziert am MCP-Transport.
    const grant = await tokens.getAccess("access-1");
    expect(grant?.userId).toBeGreaterThan(0);
    expect(grant?.audience).toBe(RESOURCE);

    const authenticator = makeBearerAuthenticator({
      tokenStore: tokens,
      resolvePlan: async () => "pro",
      audience: RESOURCE,
      now: () => 1_700_000_000_000,
    });
    const session = await authenticator({ authorization: "Bearer access-1" });
    expect(session?.plan).toBe("pro");
    expect(session?.userId).toBe(grant?.userId);
  });

  it("DbUserDirectory legt Nutzer an und speichert den Refresh-Token verschlüsselt", async () => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.googleSub, "sub-9")).limit(1);
    expect(user?.email).toBe("seo@aip.aero");

    const [cred] = await db
      .select()
      .from(schema.googleCredentials)
      .where(eq(schema.googleCredentials.userId, user!.id))
      .limit(1);
    expect(cred).toBeDefined();
    // Der abgelegte Wert ist verschlüsselt — entschlüsselt ergibt er den Klartext.
    const blob = Buffer.from(cred!.refreshTokenEnc);
    expect(blob.toString("utf8")).not.toContain("g-refresh"); // nicht im Klartext
    expect(decryptSecret(blob, KEY)).toBe("1//g-refresh");
  });

  it("Authorization-Code ist einmalig einlösbar (DELETE … RETURNING)", async () => {
    const p = newProvider();
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE });
    await p.googleCallback({ state: "state-1", code: "g" });
    const first = await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });
    expect(first.status).toBe(200);
    const second = await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });
    expect(second.status).toBe(400);
  });

  it("Refresh-Rotation: alter Refresh-Token verschwindet aus der DB", async () => {
    const p = newProvider();
    await p.authorize({ response_type: "code", client_id: "client-1", redirect_uri: REDIRECT, code_challenge: CHALLENGE });
    await p.googleCallback({ state: "state-1", code: "g" });
    const first = await p.token({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT, client_id: "client-1", code_verifier: VERIFIER });
    const oldRefresh = first.body.refresh_token as string;

    const refreshed = await p.token({ grant_type: "refresh_token", refresh_token: oldRefresh, client_id: "client-1" });
    expect(refreshed.status).toBe(200);
    expect(await tokens.getRefresh(oldRefresh)).toBeUndefined();
    expect(await tokens.getRefresh(refreshed.body.refresh_token as string)).toBeDefined();
  });
});
