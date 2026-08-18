import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type Db } from "@gsc/db";
import { makeOwnershipCheck, makePlanResolver } from "../src/index.ts";
import type pg from "pg";

/**
 * Integrationstest der DB-Resolver gegen echtes PostgreSQL: Mandantenprüfung
 * (Property-Eigentum, gelöschte ausgeschlossen) und Plan-Auflösung aus der Subscription.
 */

const PGURL = process.env.PGURL;
const migration = readFileSync(
  fileURLToPath(new URL("../../../packages/db/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

describe.skipIf(!PGURL)("DB-Resolver (PostgreSQL)", () => {
  let db: Db;
  let pool: pg.Pool;
  let userA: number;
  let userB: number;
  let propA: number;

  beforeAll(async () => {
    ({ db, pool } = createDb({ url: PGURL!, maxConnections: 4 }));
    await pool.query("DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS wh CASCADE;");
    await pool.query(migration);
    const a = await pool.query("INSERT INTO core.users (public_id, google_sub, email) VALUES ('ua','sa','a@b.de') RETURNING id");
    const b = await pool.query("INSERT INTO core.users (public_id, google_sub, email) VALUES ('ub','sb','b@b.de') RETURNING id");
    userA = Number(a.rows[0].id);
    userB = Number(b.rows[0].id);
    const p = await pool.query(
      `INSERT INTO core.properties (public_id, user_id, site_url, kind, permission)
       VALUES ('pa', $1, 'sc-domain:a.example', 'domain', 'siteOwner') RETURNING id`,
      [userA],
    );
    propA = Number(p.rows[0].id);
    // Eine gelöschte Property von A.
    await pool.query(
      `INSERT INTO core.properties (public_id, user_id, site_url, kind, permission, deleted_at)
       VALUES ('pdel', $1, 'sc-domain:del.example', 'domain', 'siteOwner', now())`,
      [userA],
    );
    // A hat ein aktives Pro-Abo.
    await pool.query(
      "INSERT INTO core.subscriptions (user_id, plan, status) VALUES ($1, 'pro', 'active')",
      [userA],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("ownershipCheck: Eigentümer ja, Fremder nein", async () => {
    const owns = makeOwnershipCheck(db);
    expect(await owns(userA, propA)).toBe(true);
    expect(await owns(userB, propA)).toBe(false);
  });

  it("ownershipCheck: gelöschte Property zählt nicht", async () => {
    const owns = makeOwnershipCheck(db);
    const del = await pool.query("SELECT id FROM core.properties WHERE public_id='pdel'");
    expect(await owns(userA, Number(del.rows[0].id))).toBe(false);
  });

  it("planResolver: aktives Abo liefert den Plan, sonst free", async () => {
    const plan = makePlanResolver(db);
    expect(await plan(userA)).toBe("pro");
    expect(await plan(userB)).toBe("free"); // kein Abo

    // Gekündigt/inaktiv → free.
    await pool.query("UPDATE core.subscriptions SET status='canceled' WHERE user_id=$1", [userA]);
    expect(await plan(userA)).toBe("free");
  });
});
