import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, WarehouseWriter, WarehouseRepository, findClickDrift, type Db } from "../src/index.ts";
import type pg from "pg";

/**
 * Integrationstest des Schreibpfads gegen echtes PostgreSQL: schreiben, Abstimmung
 * prüfen (SUM(fact_query)=fact_totals), über WarehouseRepository zurücklesen, Idempotenz
 * und Wörterbuch-Wiederverwendung. Läuft nur mit PGURL.
 */

const PGURL = process.env.PGURL;
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

describe.skipIf(!PGURL)("WarehouseWriter (PostgreSQL)", () => {
  let db: Db;
  let pool: pg.Pool;
  let writer: WarehouseWriter;
  let repo: WarehouseRepository;
  let pid: number;

  beforeAll(async () => {
    ({ db, pool } = createDb({ url: PGURL!, maxConnections: 4 }));
    await pool.query("DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS wh CASCADE;");
    await pool.query(migration);
    const u = await pool.query(
      "INSERT INTO core.users (public_id, google_sub, email) VALUES ('u1','sub1','a@b.de') RETURNING id",
    );
    const p = await pool.query(
      `INSERT INTO core.properties (public_id, user_id, site_url, kind, permission)
       VALUES ('p1', $1, 'sc-domain:example.com', 'domain', 'siteOwner') RETURNING id`,
      [u.rows[0].id],
    );
    pid = Number(p.rows[0].id);
    writer = new WarehouseWriter(db);
    repo = new WarehouseRepository(db);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("schreibt Totals und Query-Fakten abstimmbar (Sammelposten inklusive)", async () => {
    await writer.writeTotals(pid, [
      { day: "2026-08-16", searchType: "web", clicks: 989, impressions: 30607, positionSum: 30607 * 7.8 },
    ]);
    await writer.writeQueryFacts(pid, [
      { query: "aip germany", day: "2026-08-16", searchType: "web", clicks: 520, impressions: 15000, positionSum: 48000 },
      { query: "aip", day: "2026-08-16", searchType: "web", clicks: 5, impressions: 30, positionSum: 81 },
      // Sammelposten: 520 + 5 + 464 = 989 = Totals
      { query: null, day: "2026-08-16", searchType: "web", clicks: 464, impressions: 15577, positionSum: 15577 * 7.9 },
    ]);

    // Abstimmung: keine Drift.
    expect(await findClickDrift(db, pid, "2026-08-01", "2026-08-31")).toEqual([]);

    // Rücklesen über das Read-Repository: Segmente ohne Sammelposten, Sammelposten separat.
    const perf = await repo.performance({
      propertyId: pid,
      dimension: "query",
      period: { from: "2026-08-01", to: "2026-08-31" },
      searchType: "web",
      sortBy: "clicks",
      limit: 100,
    });
    expect(perf.rows.map((r) => r.key)).toEqual(["aip germany", "aip"]);
    expect(perf.totals.clicks).toBe(989);
    expect(perf.anonymized?.clicks).toBe(464);
    expect(perf.anonymizedImpressions).toBe(15577);
  });

  it("ist idempotent: erneutes Schreiben aktualisiert statt zu duplizieren", async () => {
    // Korrigierte Totals für denselben Tag.
    await writer.writeTotals(pid, [
      { day: "2026-08-16", searchType: "web", clicks: 990, impressions: 30610, positionSum: 30610 * 7.8 },
    ]);
    const totals = await pool.query(
      "SELECT count(*)::int AS n, max(clicks) AS clicks FROM wh.fact_totals WHERE property_id=$1 AND day='2026-08-16'",
      [pid],
    );
    expect(totals.rows[0].n).toBe(1); // nicht dupliziert
    expect(totals.rows[0].clicks).toBe(990); // aktualisiert
  });

  it("verwendet Wörterbucheinträge wieder (stabile query_id)", async () => {
    // Gleiche Query an einem anderen Tag.
    await writer.writeTotals(pid, [
      { day: "2026-08-17", searchType: "web", clicks: 500, impressions: 12000, positionSum: 12000 * 3 },
    ]);
    await writer.writeQueryFacts(pid, [
      { query: "aip germany", day: "2026-08-17", searchType: "web", clicks: 500, impressions: 12000, positionSum: 36000 },
    ]);
    const rows = await pool.query("SELECT count(*)::int AS n FROM wh.dim_query WHERE property_id=$1 AND text='aip germany'", [pid]);
    expect(rows.rows[0].n).toBe(1); // ein Wörterbucheintrag, wiederverwendet

    // first_seen/last_seen spannen jetzt beide Tage.
    const span = await pool.query(
      "SELECT first_seen::text AS f, last_seen::text AS l FROM wh.dim_query WHERE property_id=$1 AND text='aip germany'",
      [pid],
    );
    expect(span.rows[0].f).toBe("2026-08-16");
    expect(span.rows[0].l).toBe("2026-08-17");
  });

  it("schreibt Seiten-Fakten und liest sie zurück", async () => {
    await writer.writeTotals(pid, [
      { day: "2026-08-18", searchType: "web", clicks: 300, impressions: 8000, positionSum: 8000 * 4 },
    ]);
    await writer.writePageFacts(pid, [
      { page: "https://example.com/charts", day: "2026-08-18", searchType: "web", clicks: 250, impressions: 5500, positionSum: 5500 * 4.2 },
      { page: "https://example.com/vfr", day: "2026-08-18", searchType: "web", clicks: 50, impressions: 2500, positionSum: 2500 * 9 },
    ]);
    const perf = await repo.performance({
      propertyId: pid,
      dimension: "page",
      period: { from: "2026-08-18", to: "2026-08-18" },
      searchType: "web",
      sortBy: "clicks",
      limit: 100,
    });
    expect(perf.rows.map((r) => r.key)).toEqual(["https://example.com/charts", "https://example.com/vfr"]);
    expect(perf.rows[0]!.clicks).toBe(250);
  });
});
