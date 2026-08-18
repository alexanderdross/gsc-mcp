import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type Db } from "@gsc/db";
import { GscClient, type FetchFn } from "@gsc/gsc-client";
import { IndexingRepository, type InspectionQueue } from "../src/indexing-repo.ts";
import type pg from "pg";

/**
 * Integrationstest der konkreten `IndexingRepository` gegen ein echtes PostgreSQL,
 * mit einem über `fetchFn` gefälschten GSC-Client und einer Fake-Queue. Läuft nur mit
 * PGURL (CI-Job „DDL gegen PostgreSQL"); sonst übersprungen.
 */

const PGURL = process.env.PGURL;
const migration = readFileSync(
  fileURLToPath(new URL("../../../packages/db/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

/** Zählt Aufrufe und liefert kanonische GSC-Antworten je Endpunkt. */
function fakeClient() {
  const calls = { inspect: 0, listSitemaps: 0, submit: 0 };
  const fetchFn: FetchFn = async (url, init) => {
    let payload: unknown = {};
    if (url.includes("urlInspection/index:inspect")) {
      calls.inspect++;
      payload = {
        inspectionResult: {
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            indexingState: "INDEXING_ALLOWED",
            robotsTxtState: "ALLOWED",
            pageFetchState: "SUCCESSFUL",
            lastCrawlTime: "2026-08-10T00:00:00Z",
            googleCanonical: "https://example.com/a",
            userCanonical: "https://example.com/a",
          },
        },
      };
    } else if (url.includes("/sitemaps") && init.method === "GET") {
      calls.listSitemaps++;
      payload = {
        sitemap: [
          { path: "https://example.com/sitemap.xml", isPending: false, isSitemapsIndex: true, warnings: "2", errors: "0" },
        ],
      };
    } else if (init.method === "PUT") {
      calls.submit++;
      payload = {};
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  const client = new GscClient({ tokenProvider: async () => "test-token", fetchFn });
  return { client, calls };
}

function fakeQueue(): InspectionQueue & { enqueued: string[] } {
  const q: InspectionQueue & { enqueued: string[] } = {
    enqueued: [],
    async enqueue(_p, urls) {
      q.enqueued.push(...urls);
    },
  };
  return q;
}

describe.skipIf(!PGURL)("IndexingRepository (PostgreSQL + Fake-GSC-Client)", () => {
  let db: Db;
  let pool: pg.Pool;
  let pid: number;

  beforeAll(async () => {
    ({ db, pool } = createDb({ url: PGURL!, maxConnections: 4 }));
    await pool.query("DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS wh CASCADE;");
    await pool.query(migration);
    for (const m of ["2026-07-01", "2026-08-01"]) {
      await pool.query("SELECT wh.ensure_month_partitions($1)", [m]);
    }

    const u = await pool.query(
      "INSERT INTO core.users (public_id, google_sub, email) VALUES ('u1','sub1','a@b.de') RETURNING id",
    );
    const p = await pool.query(
      `INSERT INTO core.properties (public_id, user_id, site_url, kind, permission)
       VALUES ('p1', $1, 'sc-domain:example.com', 'domain', 'siteOwner') RETURNING id`,
      [u.rows[0].id],
    );
    pid = Number(p.rows[0].id);

    // Seiten + Traffic für die Kandidatenauswahl.
    const dp = await pool.query(
      `INSERT INTO wh.dim_page (property_id, url, path, depth, first_seen, last_seen) VALUES
         ($1,'https://example.com/a','/a',1,'2026-07-01','2026-08-16'),
         ($1,'https://example.com/b','/b',1,'2026-07-01','2026-08-16'),
         ($1,'https://example.com/c','/c',1,'2026-07-01','2026-08-16') RETURNING id, url`,
      [pid],
    );
    const pageId = new Map<string, number>(dp.rows.map((r: { url: string; id: string }) => [r.url, Number(r.id)]));
    await pool.query(
      `INSERT INTO wh.fact_page (property_id, day, search_type, page_id, clicks, impressions, position_sum) VALUES
         ($1,'2026-08-16','web',$2,900,10000,10000*3),
         ($1,'2026-08-16','web',$3,300,4000,4000*5),
         ($1,'2026-08-16','web',$4,50,800,800*9)`,
      [pid, pageId.get("https://example.com/a"), pageId.get("https://example.com/b"), pageId.get("https://example.com/c")],
    );

    // Eine gespeicherte Inspektion (für inspectionRecords und den Cache-Treffer).
    await pool.query(
      `INSERT INTO wh.url_inspections (property_id, url, inspected_at, verdict, coverage_state, indexing_state)
       VALUES ($1,'https://example.com/a', now(), 'PASS', 'Submitted and indexed', 'INDEXING_ALLOWED')`,
      [pid],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("inspect: Cache-Treffer ohne GSC-Aufruf", async () => {
    const { client, calls } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue: fakeQueue(), dailyBudget: 5 });
    const rec = await repo.inspect(pid, "https://example.com/a", false);
    expect(rec.verdict).toBe("PASS");
    expect(calls.inspect).toBe(0); // aus dem Cache bedient
  });

  it("inspect: force_refresh ruft GSC, speichert und verbraucht Budget", async () => {
    const { client, calls } = fakeClient();
    const queue = fakeQueue();
    const repo = new IndexingRepository({ db, client, queue, dailyBudget: 5 });

    const before = await repo.inspectionBudget(pid);
    const rec = await repo.inspect(pid, "https://example.com/neu", true);
    expect(calls.inspect).toBe(1);
    expect(rec.verdict).toBe("PASS");
    // Frisch aus der GSC-Antwort (nicht aus dem DB-Roundtrip): Originalstempel.
    expect(rec.lastCrawl).toBe("2026-08-10T00:00:00Z");

    const after = await repo.inspectionBudget(pid);
    expect(after.remaining).toBe(before.remaining - 1);

    // Ergebnis ist jetzt im Cache (zweiter Aufruf ohne force ruft GSC nicht erneut).
    const { client: c2, calls: k2 } = fakeClient();
    const repo2 = new IndexingRepository({ db, client: c2, queue, dailyBudget: 5 });
    await repo2.inspect(pid, "https://example.com/neu", false);
    expect(k2.inspect).toBe(0);
  });

  it("enqueueInspections: reiht ein und reserviert Budget", async () => {
    const queue = fakeQueue();
    const { client } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue, dailyBudget: 100 });
    const before = (await repo.inspectionBudget(pid)).remaining;
    await repo.enqueueInspections(pid, ["https://example.com/b", "https://example.com/c"]);
    expect(queue.enqueued).toEqual(["https://example.com/b", "https://example.com/c"]);
    const after = (await repo.inspectionBudget(pid)).remaining;
    expect(after).toBe(before - 2);
  });

  it("bulkCandidates(top_traffic): Seiten nach Klicks absteigend", async () => {
    const { client } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue: fakeQueue(), dailyBudget: 2000 });
    const urls = await repo.bulkCandidates(pid, "top_traffic");
    expect(urls).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  it("bulkCandidates(never_inspected): nur Seiten ohne Inspektion", async () => {
    const { client } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue: fakeQueue(), dailyBudget: 2000 });
    const urls = await repo.bulkCandidates(pid, "never_inspected");
    // /a ist bereits inspiziert; /neu ist keine dim_page-Seite.
    expect(urls.sort()).toEqual(["https://example.com/b", "https://example.com/c"]);
  });

  it("listSitemaps: bildet die GSC-Antwort auf das App-Modell ab", async () => {
    const { client, calls } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue: fakeQueue(), dailyBudget: 5 });
    const maps = await repo.listSitemaps(pid);
    expect(calls.listSitemaps).toBe(1);
    expect(maps).toEqual([
      { path: "https://example.com/sitemap.xml", isPending: false, isIndex: true, warnings: 2, errors: 0 },
    ]);
  });

  it("submitSitemap: reicht über den GSC-Client ein", async () => {
    const { client, calls } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue: fakeQueue(), dailyBudget: 5 });
    await repo.submitSitemap(pid, "https://example.com/sitemap.xml");
    expect(calls.submit).toBe(1);
  });

  it("inspectionRecords: liefert die gespeicherten Inspektionen", async () => {
    const { client } = fakeClient();
    const repo = new IndexingRepository({ db, client, queue: fakeQueue(), dailyBudget: 5 });
    const records = await repo.inspectionRecords(pid);
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.some((r) => r.url === "https://example.com/a" && r.verdict === "PASS")).toBe(true);
  });
});
