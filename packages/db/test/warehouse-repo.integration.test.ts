import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { avgPosition } from "@gsc/core";
import { createDb, type Db } from "../src/client.ts";
import { WarehouseRepository } from "../src/repositories/warehouse-repo.ts";
import type pg from "pg";

/**
 * Integrationstest der konkreten `WarehouseRepository` gegen ein echtes PostgreSQL.
 * Läuft nur, wenn PGURL gesetzt ist (CI-Job „DDL gegen PostgreSQL"); im schnellen
 * Test-Job ohne Datenbank wird die Suite übersprungen.
 *
 * Die Zahlen stammen aus der Messung an aip.aero und wahren die Kernvariante des
 * Modells: SUM(fact_query) = fact_totals je Tag.
 */

const PGURL = process.env.PGURL;
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)),
  "utf8",
);
const web = "web";

describe.skipIf(!PGURL)("WarehouseRepository (PostgreSQL)", () => {
  let db: Db;
  let pool: pg.Pool;
  let repo: WarehouseRepository;
  let pid: number;

  beforeAll(async () => {
    ({ db, pool } = createDb({ url: PGURL!, maxConnections: 4 }));

    // Frisches Schema aus der kanonischen Migration.
    await pool.query("DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS wh CASCADE;");
    await pool.query(migration);

    // Monatspartitionen für alle im Fixture verwendeten Monate.
    for (const m of ["2025-08-01", "2026-07-01", "2026-08-01"]) {
      await pool.query("SELECT wh.ensure_month_partitions($1)", [m]);
    }

    // Nutzer + Property.
    const u = await pool.query(
      "INSERT INTO core.users (public_id, google_sub, email) VALUES ('u1','sub1','a@b.de') RETURNING id",
    );
    const p = await pool.query(
      `INSERT INTO core.properties (public_id, user_id, site_url, kind, permission)
       VALUES ('p1', $1, 'sc-domain:example.com', 'domain', 'siteOwner') RETURNING id`,
      [u.rows[0].id],
    );
    pid = Number(p.rows[0].id);

    // Dimensionen.
    const dq = await pool.query(
      `INSERT INTO wh.dim_query (property_id, text, word_count, first_seen, last_seen) VALUES
         ($1,'aip germany',2,'2025-01-01','2026-08-16'),
         ($1,'aip',1,'2025-01-01','2026-08-16') RETURNING id, text`,
      [pid],
    );
    const qId = new Map<string, number>(dq.rows.map((r: { text: string; id: string }) => [r.text, Number(r.id)]));
    const q1 = qId.get("aip germany")!; // "aip germany"
    const q2 = qId.get("aip")!;

    const dp = await pool.query(
      `INSERT INTO wh.dim_page (property_id, url, path, depth, first_seen, last_seen) VALUES
         ($1,'/charts','/charts',1,'2025-01-01','2026-08-16'),
         ($1,'/vfr','/vfr',1,'2025-01-01','2026-08-16') RETURNING id, url`,
      [pid],
    );
    const pId = new Map<string, number>(dp.rows.map((r: { url: string; id: string }) => [r.url, Number(r.id)]));
    const p1 = pId.get("/charts")!;
    const p2 = pId.get("/vfr")!;

    // fact_totals: die kleine, vollständige Bezugsgröße.
    await pool.query(
      `INSERT INTO wh.fact_totals (property_id, day, search_type, clicks, impressions, position_sum) VALUES
         ($1,'2026-07-20','web',772,16666,16666*7.3),
         ($1,'2026-08-16','web',989,30607,30607*7.8),
         ($1,'2025-08-16','web',900,20000,20000*7.0)`,
      [pid],
    );

    // fact_query inkl. Sammelposten query_id=0 — Summe stimmt je Tag mit fact_totals.
    await pool.query(
      `INSERT INTO wh.fact_query (property_id, day, search_type, query_id, clicks, impressions, position_sum) VALUES
         ($1,'2026-07-20','web',$2,400,8000,8000*3),
         ($1,'2026-07-20','web',$3,4,26,26*2.8),
         ($1,'2026-07-20','web',0,368,8640,8640*7.6),
         ($1,'2026-08-16','web',$2,520,15000,15000*3.2),
         ($1,'2026-08-16','web',$3,5,30,30*2.7),
         ($1,'2026-08-16','web',0,464,15577,15577*7.9)`,
      [pid, q1, q2],
    );

    // fact_page: Grundlage für Seiten-Performance, Export und Content-Decay.
    await pool.query(
      `INSERT INTO wh.fact_page (property_id, day, search_type, page_id, clicks, impressions, position_sum) VALUES
         ($1,'2026-07-20','web',$2,300,6000,6000*4),
         ($1,'2026-08-16','web',$2,250,5500,5500*4.2),
         ($1,'2026-08-16','web',$3,120,3000,3000*9),
         ($1,'2025-08-16','web',$2,400,7000,7000*5)`,
      [pid, p1, p2],
    );

    // fact_query_page über zwei Wochen mit wechselnder Ziel-URL.
    await pool.query(
      `INSERT INTO wh.fact_query_page (property_id, day, search_type, query_id, page_id, clicks, impressions, position_sum) VALUES
         ($1,'2026-07-20','web',$2,$3,100,2000,2000*3),
         ($1,'2026-08-16','web',$2,$4,90,1800,1800*5)`,
      [pid, q1, p1, p2],
    );

    // fact_geo_device für die Länder-/Geräte-Dimension.
    await pool.query(
      `INSERT INTO wh.fact_geo_device (property_id, day, search_type, country, device, clicks, impressions, position_sum) VALUES
         ($1,'2026-08-16','web','DEU','MOBILE',500,12000,12000*6),
         ($1,'2026-08-16','web','USA','DESKTOP',300,9000,9000*8)`,
      [pid],
    );

    // Sync-Abdeckung für die ehrliche covered-Angabe.
    await pool.query(
      `INSERT INTO core.sync_state (property_id, grain, search_type, covered_from, covered_to)
       VALUES ($1,'query','web','2026-07-01','2026-08-10')`,
      [pid],
    );

    repo = new WarehouseRepository(db);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const jul = { from: "2026-07-01", to: "2026-08-31" };

  it("performance(query): aggregiert Segmente, schließt den Sammelposten aus und weist ihn separat aus", async () => {
    const res = await repo.performance({
      propertyId: pid,
      dimension: "query",
      period: jul,
      searchType: web,
      sortBy: "clicks",
      limit: 100,
    });

    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]!.key).toBe("aip germany");
    expect(res.rows[0]!.clicks).toBe(920); // 400 + 520
    expect(res.rows[0]!.impressions).toBe(23000);
    expect(avgPosition(res.rows[0]!)).toBeCloseTo(72000 / 23000, 6);

    // Gesamtwerte aus fact_totals (nur 2026, nicht die Vorjahreszeile).
    expect(res.totals.clicks).toBe(1761);
    expect(res.totals.impressions).toBe(47273);

    // Sammelposten query_id=0.
    expect(res.anonymizedImpressions).toBe(24217); // 8640 + 15577
    expect(res.anonymized?.clicks).toBe(832); // 368 + 464
    expect(res.source).toBe("warehouse");
  });

  it("performance(query): covered schneidet den Zeitraum auf die Sync-Abdeckung zu", async () => {
    const res = await repo.performance({
      propertyId: pid,
      dimension: "query",
      period: jul,
      searchType: web,
      limit: 10,
    });
    expect(res.covered.from).toBe("2026-07-01");
    expect(res.covered.to).toBe("2026-08-10"); // min(covered_to, angefragt)
  });

  it("performance(query): query_contains filtert über das Wörterbuch", async () => {
    const res = await repo.performance({
      propertyId: pid,
      dimension: "query",
      period: jul,
      searchType: web,
      queryContains: "germany",
      limit: 100,
    });
    expect(res.rows.map((r) => r.key)).toEqual(["aip germany"]);
  });

  it("performance(query): sort_by position ordnet impressionsgewichtet aufsteigend", async () => {
    const res = await repo.performance({
      propertyId: pid,
      dimension: "query",
      period: jul,
      searchType: web,
      sortBy: "position",
      limit: 100,
    });
    // "aip" (~2,75) rankt vor "aip germany" (~3,13).
    expect(res.rows.map((r) => r.key)).toEqual(["aip", "aip germany"]);
  });

  it("performance(country): gruppiert fact_geo_device nach Land", async () => {
    const res = await repo.performance({
      propertyId: pid,
      dimension: "country",
      period: { from: "2026-08-01", to: "2026-08-31" },
      searchType: web,
      sortBy: "clicks",
      limit: 100,
    });
    const de = res.rows.find((r) => r.key === "DEU");
    expect(de?.clicks).toBe(500);
    expect(res.anonymizedImpressions).toBe(0); // Anonymisierung betrifft nur die Query-Dimension
  });

  it("segmentPairs(query): richtet zwei Zeiträume je Query aus, ohne den Sammelposten", async () => {
    const pairs = await repo.segmentPairs(
      pid,
      "query",
      { from: "2026-07-20", to: "2026-07-20" },
      { from: "2026-08-16", to: "2026-08-16" },
      web,
    );
    const g = pairs.find((p) => p.key === "aip germany");
    expect(g?.a.clicks).toBe(400);
    expect(g?.b.clicks).toBe(520);
    // Kein anonymisierter Sammelposten als Segment.
    expect(pairs.map((p) => p.key).sort()).toEqual(["aip", "aip germany"]);
  });

  it("timeseries: tägliche Klicks aus fact_totals, aufsteigend", async () => {
    const series = await repo.timeseries(pid, jul, web);
    expect(series).toEqual([
      { date: "2026-07-20", clicks: 772 },
      { date: "2026-08-16", clicks: 989 },
    ]);
  });

  it("cannibalizationRows: Query×URL×Woche mit Montags-Wochenschlüssel", async () => {
    const rows = await repo.cannibalizationRows(pid, jul, web);
    expect(rows).toHaveLength(2);
    const byWeek = new Map(rows.map((r) => [r.week, r]));
    expect(byWeek.get("2026-07-20")?.url).toBe("/charts");
    expect(byWeek.get("2026-08-10")?.url).toBe("/vfr"); // 2026-08-16 (So) → Montag 2026-08-10
    expect(byWeek.get("2026-07-20")?.query).toBe("aip germany");
  });

  it("decayInputs: Seiten-YoY und Monatsreihe plus Site-YoY", async () => {
    const { pages, siteYoy } = await repo.decayInputs(pid, web);
    const charts = pages.find((p) => p.key === "/charts");
    expect(charts?.recentClicks).toBe(550); // 300 + 250 im Aktualfenster
    expect(charts?.priorYearClicks).toBe(400); // 2025-08-16
    expect(charts?.monthly).toEqual([400, 300, 250]); // 2025-08, 2026-07, 2026-08 aufsteigend
    const vfr = pages.find((p) => p.key === "/vfr");
    expect(vfr?.priorYearClicks).toBe(0);
    // Site-YoY: (772+989 − 900) / 900.
    expect(siteYoy).toBeCloseTo((1761 - 900) / 900, 6);
  });

  it("exportDataset(totals): flache Tageszeilen mit gerechneter Position und CTR", async () => {
    const rows = await repo.exportDataset(pid, "totals", jul);
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(first.day).toBe("2026-07-20");
    expect(first.clicks).toBe(772);
    expect(first.impressions).toBe(16666);
    expect(first.position).toBeCloseTo(7.3, 6);
    expect(first.ctr).toBeCloseTo(Number((772 / 16666).toFixed(4)), 6);
  });

  it("exportDataset(query): enthält den Sammelposten als '(anonymisiert)'", async () => {
    const rows = await repo.exportDataset(pid, "query", jul);
    expect(rows).toHaveLength(6); // 3 Zeilen je Tag × 2 Tage
    expect(rows.some((r) => r.query === "(anonymisiert)")).toBe(true);
    // Abstimmung je Tag: Summe der Query-Klicks = fact_totals.
    const jul20 = rows.filter((r) => r.day === "2026-07-20");
    expect(jul20.reduce((s, r) => s + (r.clicks as number), 0)).toBe(772);
  });

  it("exportDataset(page) und (query_page): liefern die erwarteten Schlüsselspalten", async () => {
    const pages = await repo.exportDataset(pid, "page", jul);
    expect(pages).toHaveLength(3);
    expect(pages.every((r) => typeof r.page === "string")).toBe(true);

    const qp = await repo.exportDataset(pid, "query_page", jul);
    expect(qp).toHaveLength(2);
    expect(qp[0]).toHaveProperty("query");
    expect(qp[0]).toHaveProperty("page");
  });
});
