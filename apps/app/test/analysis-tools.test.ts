import { describe, it, expect } from "vitest";
import type { Fact } from "@gsc/core";
import type { SeriesPoint, CannibalInput, DecayInput } from "@gsc/analytics";
import { buildRegistry, Router, type WarehouseRepo, type PerfRow } from "../src/index.ts";

function fact(clicks: number, impressions: number, position: number): Fact {
  return { clicks, impressions, positionSum: position * impressions };
}
function prow(key: string, clicks: number, impressions: number, position: number): PerfRow {
  return { key, ...fact(clicks, impressions, position) };
}

/** Fake-Repo mit einstellbaren Rückgaben je Methode. */
function fakeRepo(over: Partial<WarehouseRepo>): WarehouseRepo {
  return {
    async performance(q) {
      return { rows: [], totals: fact(0, 0, 0), anonymizedImpressions: 0, source: "warehouse", covered: q.period };
    },
    async segmentPairs() {
      return [];
    },
    async timeseries() {
      return [];
    },
    async cannibalizationRows() {
      return [];
    },
    async decayInputs() {
      return { pages: [], siteYoy: 0 };
    },
    ...over,
  };
}

const pro = { plan: "pro", userId: 1, propertyId: 7, detail: "standard" } as const;
const owns = async () => true;

function run(repo: WarehouseRepo, tool: string, input: unknown) {
  return new Router(buildRegistry({ repo }), { ownershipCheck: owns }).run(pro, tool, input);
}

describe("striking_distance", () => {
  it("meldet Kandidaten mit Klickpotenzial aus den Query-Daten", async () => {
    const rows: PerfRow[] = [
      // Kurvenmaterial: gute CTR auf vorderen Positionen.
      ...Array.from({ length: 20 }, (_, i) => prow(`k${i}`, Math.round(3000 / (i + 1)), 10_000, i + 1)),
      prow("chance", 200, 8000, 12), // Position 12, viel Volumen, niedrige CTR
    ];
    const repo = fakeRepo({
      async performance(q) {
        return { rows, totals: fact(0, 0, 0), anonymizedImpressions: 0, source: "warehouse", covered: q.period };
      },
    });
    const res = await run(repo, "striking_distance", { from: "2026-08-01", to: "2026-08-16" });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const out = res.output as { rows: Array<{ key: string; potentialClicks: number }> };
    expect(out.rows.some((r) => r.key === "chance")).toBe(true);
  });

  it("ist für Free gesperrt (Basis-Analyse ab Starter)", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo({}) }), { ownershipCheck: owns });
    const res = await router.run({ plan: "free", userId: 1, propertyId: 7 }, "striking_distance", {
      from: "2026-08-01",
      to: "2026-08-16",
    });
    expect(res.kind).toBe("denied");
  });
});

describe("brand_vs_nonbrand", () => {
  it("segmentiert nach Muster und weist den anonymisierten Rest getrennt aus", async () => {
    const repo = fakeRepo({
      async performance(q) {
        return {
          rows: [prow("aip germany", 100, 1000, 3), prow("vfr charts", 40, 800, 4)],
          totals: fact(140, 1800, 3.5),
          anonymizedImpressions: 20_000,
          anonymized: fact(500, 20_000, 8),
          source: "warehouse",
          covered: q.period,
        };
      },
    });
    const res = await run(repo, "brand_vs_nonbrand", {
      from: "2026-08-01",
      to: "2026-08-16",
      pattern: "aip",
    });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as {
      brand: { clicks: number };
      nonBrand: { clicks: number };
      unassigned: { impressions: number };
    };
    expect(out.brand.clicks).toBe(100);
    expect(out.nonBrand.clicks).toBe(40);
    expect(out.unassigned.impressions).toBe(20_000);
  });

  it("lehnt ein ungültiges Regex-Muster als Fehler ab", async () => {
    const res = await run(fakeRepo({}), "brand_vs_nonbrand", {
      from: "2026-08-01",
      to: "2026-08-16",
      pattern: "(unbalanced",
    });
    expect(res.kind).toBe("error");
  });
});

describe("detect_anomalies", () => {
  it("findet einen eingebrochenen Tag in der Zeitreihe", async () => {
    const mult = [0.6, 1, 1.1, 1.1, 1.05, 0.95, 0.6];
    const series: SeriesPoint[] = [];
    const start = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 56; i++) {
      const d = new Date(start + i * 86_400_000);
      series.push({ date: d.toISOString().slice(0, 10), clicks: Math.round(1000 * mult[d.getUTCDay()]!) });
    }
    series[45] = { date: series[45]!.date, clicks: 300 };
    const repo = fakeRepo({ async timeseries() { return series; } });
    const res = await run(repo, "detect_anomalies", { from: series[0]!.date, to: series[55]!.date });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { rows: Array<{ date: string; kind: string }> };
    expect(out.rows.some((a) => a.date === series[45]!.date && a.kind === "drop")).toBe(true);
  });
});

describe("find_cannibalization", () => {
  it("erkennt eine Query mit wechselnder Ziel-URL", async () => {
    const rows: CannibalInput[] = [
      { query: "charts", url: "/a", week: "2026-08-03", ...fact(50, 1000, 4) },
      { query: "charts", url: "/b", week: "2026-08-10", ...fact(55, 1100, 4) },
      { query: "charts", url: "/a", week: "2026-08-17", ...fact(48, 980, 4) },
      { query: "charts", url: "/b", week: "2026-08-03", ...fact(10, 400, 8) },
      { query: "charts", url: "/a", week: "2026-08-10", ...fact(12, 420, 8) },
      { query: "charts", url: "/b", week: "2026-08-17", ...fact(9, 380, 9) },
    ];
    const repo = fakeRepo({ async cannibalizationRows() { return rows; } });
    const res = await run(repo, "find_cannibalization", { from: "2026-08-01", to: "2026-08-17" });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { rows: Array<{ query: string }> };
    expect(out.rows.map((r) => r.query)).toContain("charts");
  });
});

describe("content_decay", () => {
  it("meldet seitenspezifischen Verfall und reicht den Site-YoY durch", async () => {
    const pages: DecayInput[] = [
      { key: "/verfall", recentClicks: 300, priorYearClicks: 1000, monthly: [1000, 800, 600, 400, 300] },
      { key: "/stabil", recentClicks: 900, priorYearClicks: 1000, monthly: [1000, 950, 920, 910, 900] },
    ];
    const repo = fakeRepo({ async decayInputs() { return { pages, siteYoy: -0.1 }; } });
    const res = await run(repo, "content_decay", {});
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { siteYoy: number; rows: Array<{ key: string }> };
    expect(out.siteYoy).toBe(-0.1);
    expect(out.rows.map((r) => r.key)).toEqual(["/verfall"]);
  });
});

describe("ctr_analysis", () => {
  it("findet Seiten unter der eigenen CTR-Kurve", async () => {
    const rows: PerfRow[] = [
      prow("/normal", 1000, 10_000, 3),
      prow("/schwach", 150, 10_000, 3),
      prow("/ok", 1200, 10_000, 3),
      prow("/ref1", 3000, 10_000, 1),
      prow("/ref2", 500, 10_000, 6),
    ];
    const repo = fakeRepo({
      async performance(q) {
        return { rows, totals: fact(0, 0, 0), anonymizedImpressions: 0, source: "warehouse", covered: q.period };
      },
    });
    const res = await run(repo, "ctr_analysis", { from: "2026-08-01", to: "2026-08-16", scope: "page" });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { rows: Array<{ key: string }> };
    expect(out.rows.some((r) => r.key === "/schwach")).toBe(true);
    expect(out.rows.some((r) => r.key === "/normal")).toBe(false);
  });
});
