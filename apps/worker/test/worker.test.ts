import { describe, it, expect } from "vitest";
import {
  refill,
  take,
  adjustRate,
  planBackfill,
  planDelta,
  addDays,
  eachDayDesc,
  PRIORITY,
  toPositionSum,
  pivotAppearance,
  toQueryFact,
  type BucketState,
  type BucketConfig,
} from "../src/index.ts";

describe("Token-Bucket", () => {
  const config: BucketConfig = { ratePerSecond: 2, burst: 10 };

  it("füllt proportional zur verstrichenen Zeit, gekappt am Burst", () => {
    const s: BucketState = { tokens: 0, updatedAt: 1000 };
    expect(refill(s, config, 1000 + 1000).tokens).toBe(2); // 1 s × 2/s
    expect(refill(s, config, 1000 + 60_000).tokens).toBe(10); // Cap
  });

  it("gewährt und zieht ab, wenn genug Token da sind", () => {
    const s: BucketState = { tokens: 5, updatedAt: 0 };
    const r = take(s, config, 0, 3);
    expect(r.granted).toBe(true);
    expect(r.state.tokens).toBe(2);
    expect(r.retryAfterMs).toBe(0);
  });

  it("verweigert und nennt die Wartezeit, wenn zu wenige Token da sind", () => {
    const s: BucketState = { tokens: 1, updatedAt: 0 };
    const r = take(s, config, 0, 5); // 4 fehlen, 2/s ⇒ 2000 ms
    expect(r.granted).toBe(false);
    expect(r.retryAfterMs).toBe(2000);
    expect(r.state.tokens).toBe(1); // unverändert
  });

  it("passt die Rate adaptiv an und respektiert die Grenzen", () => {
    const bounds = { min: 0.5, max: 20 };
    expect(adjustRate(10, "throttled", bounds)).toBe(5);
    expect(adjustRate(10, "ok", bounds)).toBeCloseTo(11);
    expect(adjustRate(0.6, "throttled", bounds)).toBe(0.5); // Untergrenze
    expect(adjustRate(19, "ok", bounds)).toBe(20); // Obergrenze
  });
});

describe("Datumshilfen", () => {
  it("addDays über Monatsgrenzen", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("eachDayDesc liefert jüngsten zuerst", () => {
    expect(eachDayDesc("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-03",
      "2026-08-02",
      "2026-08-01",
    ]);
  });
});

describe("planBackfill", () => {
  const jobs = planBackfill({
    from: "2026-08-01",
    to: "2026-08-03",
    grains: ["totals", "query", "geo_device", "query_page"],
    searchTypes: ["web"],
  });

  it("stellt totals an den Anfang und query_page ans Ende", () => {
    expect(jobs[0]!.grain).toBe("totals");
    expect(jobs[jobs.length - 1]!.grain).toBe("query_page");
  });

  it("holt per-Tag-Grains mit jüngstem Tag zuerst", () => {
    const query = jobs.filter((j) => j.grain === "query");
    expect(query.map((j) => j.dateFrom)).toEqual([
      "2026-08-03",
      "2026-08-02",
      "2026-08-01",
    ]);
  });

  it("vergibt Backfill-Priorität und aufsteigende seq", () => {
    expect(jobs.every((j) => j.priority === PRIORITY.backfill)).toBe(true);
    for (let i = 1; i < jobs.length; i++) {
      expect(jobs[i]!.seq).toBeGreaterThan(jobs[i - 1]!.seq);
    }
  });

  it("überspringt nicht angeforderte Grains", () => {
    expect(jobs.some((j) => j.grain === "page")).toBe(false);
    expect(jobs.some((j) => j.grain === "appearance")).toBe(false);
  });
});

describe("planDelta", () => {
  it("holt die letzten fünf Tage je Grain und Suchtyp", () => {
    const jobs = planDelta("2026-08-17", ["totals", "query"], ["web"]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      grain: "totals",
      dateFrom: "2026-08-13",
      dateTo: "2026-08-17",
      priority: PRIORITY.delta,
    });
  });
});

describe("Bulk-Export-Transformationen", () => {
  it("rechnet die nullbasierte Positionssumme auf einsbasiert um", () => {
    // Google: sum_top_position = position0 × impressions. Wir: (position0 + 1) × impr.
    expect(toPositionSum(0, 100)).toBe(100); // Position 1 im Schnitt
    expect(toPositionSum(200, 100)).toBe(300); // Ø-Position 0-basiert 2 → 3
  });

  it("entpivotiert Appearance-Flags zu je einer Zeile", () => {
    const rows = pivotAppearance(
      { is_amp_top_stories: true, is_review_snippet: true, is_video: false },
      { clicks: 5, impressions: 50, sumTopPosition: 100 },
    );
    expect(rows.map((r) => r.appearance).sort()).toEqual(
      ["is_amp_top_stories", "is_review_snippet"].sort(),
    );
    expect(rows[0]!.positionSum).toBe(150); // 100 + 50
  });

  it("schiebt anonymisierte Anfragen in den Sammelposten", () => {
    expect(toQueryFact({
      query: null,
      isAnonymizedQuery: true,
      url: "https://x/",
      clicks: 3,
      impressions: 30,
      sumTopPosition: 60,
    }).queryText).toBeNull();

    expect(toQueryFact({
      query: "aip germany",
      isAnonymizedQuery: false,
      url: "https://x/",
      clicks: 9,
      impressions: 90,
      sumTopPosition: 90,
    }).queryText).toBe("aip germany");
  });
});
