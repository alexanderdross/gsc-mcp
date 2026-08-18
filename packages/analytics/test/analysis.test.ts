import { describe, it, expect } from "vitest";
import type { Fact } from "@gsc/core";
import {
  median,
  mad,
  theilSen,
  poissonCdf,
  fitCtrCurve,
  strikingDistance,
  ctrOutliers,
  brandSplit,
  contentDecay,
  findCannibalization,
  detectAnomalies,
  seasonalAdjust,
  type CtrObservation,
  type SeriesPoint,
} from "../src/index.ts";

function fact(clicks: number, impressions: number, position: number): Fact {
  return { clicks, impressions, positionSum: position * impressions };
}

// Eine plausible CTR-Kurve aus synthetischen Beobachtungen (0,35/Position).
const curve = fitCtrCurve(
  Array.from({ length: 30 }, (_, i): CtrObservation => {
    const position = i + 1;
    const impressions = 10_000;
    return { position, impressions, clicks: Math.round(impressions * (0.35 / position)), positionSum: position * impressions };
  }),
);

describe("stats", () => {
  it("median und mad", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([1, 1, 1])).toBe(0);
  });
  it("theilSen findet die Steigung einer Geraden", () => {
    expect(theilSen([0, 2, 4, 6].map((y, x) => ({ x, y })))).toBe(2);
    expect(theilSen([10, 8, 6, 4].map((y, x) => ({ x, y })))).toBe(-2);
  });
  it("poissonCdf ist monoton und bei 0 gleich e^-λ", () => {
    expect(poissonCdf(0, 2)).toBeCloseTo(Math.exp(-2), 9);
    expect(poissonCdf(10, 2)).toBeGreaterThan(poissonCdf(2, 2));
    expect(poissonCdf(1000, 2)).toBeCloseTo(1, 6);
  });
});

describe("strikingDistance", () => {
  it("meldet nur Kandidaten in Position 5–20 mit Potenzial, nach Potenzial sortiert", () => {
    const rows = [
      { key: "chance-gross", ...fact(50, 5000, 12) }, // viel Volumen, Position 12
      { key: "chance-klein", ...fact(8, 200, 6) },
      { key: "zu-gut", ...fact(300, 1000, 2) }, // Position < 5 → raus
      { key: "zu-tief", ...fact(5, 500, 40) }, // Position > 20 → raus
      { key: "zu-wenig", ...fact(1, 30, 8) }, // < min impressions → raus
    ];
    const res = strikingDistance(rows, curve, {});
    expect(res.map((r) => r.key)).toEqual(["chance-gross", "chance-klein"]);
    expect(res[0]!.potentialClicks).toBeGreaterThan(res[1]!.potentialClicks);
  });
});

describe("ctrOutliers", () => {
  it("findet Seiten deutlich unter der eigenen CTR-Kurve", () => {
    // Zwei Seiten auf Position 3; eine mit normaler, eine mit halbierter CTR.
    const rows = [
      { key: "normal", ...fact(1000, 10_000, 3) },
      { key: "schwach", ...fact(150, 10_000, 3) }, // CTR 1,5 % weit unter Erwartung
      { key: "ok2", ...fact(1200, 10_000, 3) },
    ];
    const res = ctrOutliers(rows, { minImpressions: 500 });
    expect(res.some((r) => r.key === "schwach")).toBe(true);
    expect(res.some((r) => r.key === "normal")).toBe(false);
  });
});

describe("brandSplit", () => {
  it("bildet drei Kategorien und weist den anonymisierten Rest getrennt aus", () => {
    const rows = [
      { key: "aip germany", ...fact(100, 1000, 3) },
      { key: "aip", ...fact(90, 2000, 7) },
      { key: "vfr charts", ...fact(40, 800, 4) },
    ];
    const anonymized = fact(500, 20_000, 8);
    const split = brandSplit(rows, /aip/i, anonymized);
    expect(split.brand.clicks).toBe(190);
    expect(split.nonBrand.clicks).toBe(40);
    expect(split.unassigned.impressions).toBe(20_000);
    const shareSum =
      split.brand.impressionShare + split.nonBrand.impressionShare + split.unassigned.impressionShare;
    expect(shareSum).toBeCloseTo(1, 9);
  });
});

describe("contentDecay", () => {
  it("meldet nur seitenspezifischen, nicht saisonalen Verfall mit fallendem Trend", () => {
    const pages = [
      { key: "verfall", recentClicks: 300, priorYearClicks: 1000, monthly: [1000, 800, 600, 400, 300] },
      { key: "saisonal", recentClicks: 850, priorYearClicks: 1000, monthly: [1000, 950, 900, 880, 850] },
      { key: "zu-klein", recentClicks: 10, priorYearClicks: 50, monthly: [50, 30, 10] },
    ];
    // Site verlor 10 % → 'saisonal' folgt nur dem Site-Trend, 'verfall' fällt stärker.
    const res = contentDecay(pages, -0.1, {});
    expect(res.map((r) => r.key)).toContain("verfall");
    expect(res.map((r) => r.key)).not.toContain("saisonal");
    expect(res.map((r) => r.key)).not.toContain("zu-klein");
  });
});

describe("findCannibalization", () => {
  it("erkennt eine Query mit wöchentlich wechselnder Ziel-URL", () => {
    const rows = [
      { query: "charts", url: "/a", week: "2026-08-03", ...fact(50, 1000, 4) },
      { query: "charts", url: "/b", week: "2026-08-03", ...fact(10, 400, 8) },
      { query: "charts", url: "/b", week: "2026-08-10", ...fact(55, 1100, 4) },
      { query: "charts", url: "/a", week: "2026-08-10", ...fact(12, 420, 8) },
      { query: "charts", url: "/a", week: "2026-08-17", ...fact(48, 980, 4) },
      { query: "charts", url: "/b", week: "2026-08-17", ...fact(9, 380, 9) },
      // stabile Query: nur eine URL → kein Fall
      { query: "stabil", url: "/x", week: "2026-08-03", ...fact(100, 2000, 3) },
      { query: "stabil", url: "/x", week: "2026-08-10", ...fact(110, 2100, 3) },
    ];
    const res = findCannibalization(rows, curve, {});
    expect(res.map((r) => r.query)).toEqual(["charts"]);
    expect(res[0]!.switchRate).toBeGreaterThan(0);
    expect(res[0]!.clicksAtStake).toBeGreaterThanOrEqual(0);
  });
});

describe("detectAnomalies", () => {
  // 8 Wochen flache Reihe mit Wochentagsmuster, ein Tag künstlich eingebrochen.
  function buildSeries(): SeriesPoint[] {
    const mult = [0.6, 1.0, 1.1, 1.1, 1.05, 0.95, 0.6]; // So..Sa
    const out: SeriesPoint[] = [];
    const start = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01
    for (let i = 0; i < 56; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      out.push({ date: iso, clicks: Math.round(1000 * mult[d.getUTCDay()]!) });
    }
    return out;
  }

  it("rechnet das Wochentagsmuster zu einer nahezu konstanten Reihe heraus", () => {
    const y = seasonalAdjust(buildSeries());
    const tail = y.slice(14, 42); // Ränder ausgespart
    const lo = Math.min(...tail);
    const hi = Math.max(...tail);
    expect((hi - lo) / hi).toBeLessThan(0.05);
  });

  it("findet einen eingebrochenen Tag und lässt normale Tage unauffällig", () => {
    const series = buildSeries();
    series[45] = { date: series[45]!.date, clicks: 300 }; // starker Einbruch
    const anomalies = detectAnomalies(series, { sensitivity: "medium" });
    const hit = anomalies.find((a) => a.date === series[45]!.date);
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe("drop");
    // Kein normaler Tag (außer dem Einbruch) wird gemeldet.
    expect(anomalies.filter((a) => a.date !== series[45]!.date)).toHaveLength(0);
  });
});
