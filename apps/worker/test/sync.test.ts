import { describe, it, expect } from "vitest";
import { buildDayFacts, syncDay, type GscDaySource, type FactWriter } from "../src/index.ts";
import type { SearchAnalyticsRow } from "@gsc/gsc-client";

const web = "web";
const row = (keys: string[], clicks: number, impressions: number, position: number): SearchAnalyticsRow => ({
  keys,
  clicks,
  impressions,
  ctr: impressions === 0 ? 0 : clicks / impressions,
  position,
});

// aip.aero-nahe Tageswerte.
const totalsRows = [row(["2026-08-16"], 989, 30607, 7.8)];
const queryRows = [
  row(["2026-08-16", "aip germany"], 520, 15000, 3.2),
  row(["2026-08-16", "aip"], 5, 30, 2.7),
];
const pageRows = [
  row(["2026-08-16", "/charts"], 250, 5500, 4.2),
  row(["2026-08-16", "/vfr"], 120, 3000, 9),
];

describe("buildDayFacts", () => {
  const facts = buildDayFacts("2026-08-16", web, totalsRows, queryRows, pageRows);

  it("rekonstruiert den Sammelposten aus totals − Σ(named)", () => {
    const collector = facts.queries.find((q) => q.query === null);
    expect(collector).toBeDefined();
    expect(collector!.clicks).toBe(989 - 525); // 464
    expect(collector!.impressions).toBe(30607 - 15030); // 15577
    expect(collector!.positionSum).toBeCloseTo(7.8 * 30607 - (3.2 * 15000 + 2.7 * 30), 6);
  });

  it("die Summe aller Query-Fakten entspricht den Gesamtwerten (Abstimmung)", () => {
    const sum = facts.queries.reduce(
      (s, q) => ({ clicks: s.clicks + q.clicks, impressions: s.impressions + q.impressions }),
      { clicks: 0, impressions: 0 },
    );
    expect(sum.clicks).toBe(facts.totals.clicks);
    expect(sum.impressions).toBe(facts.totals.impressions);
  });

  it("mappt Seiten mit einsbasierter positionSum", () => {
    const charts = facts.pages.find((p) => p.page === "/charts");
    expect(charts).toMatchObject({ clicks: 250, impressions: 5500, positionSum: 5500 * 4.2 });
  });

  it("lässt den Sammelposten weg, wenn benannt = Gesamt", () => {
    const exact = buildDayFacts("2026-08-16", web, [row(["d"], 525, 15030, 3.1)], queryRows, []);
    expect(exact.queries.some((q) => q.query === null)).toBe(false);
  });
});

describe("syncDay", () => {
  it("holt die drei Dimensionen und schreibt sie", async () => {
    const source: GscDaySource = {
      async totals() {
        return totalsRows;
      },
      async byQuery() {
        return queryRows;
      },
      async byPage() {
        return pageRows;
      },
    };
    const written: { totals: number; queries: number; pages: number } = { totals: 0, queries: 0, pages: 0 };
    const writer: FactWriter = {
      async writeTotals(_p, rows) {
        written.totals += rows.length;
      },
      async writeQueryFacts(_p, rows) {
        written.queries += rows.length;
      },
      async writePageFacts(_p, rows) {
        written.pages += rows.length;
      },
    };
    const facts = await syncDay(writer, source, 7, "2026-08-16", web);
    expect(written).toEqual({ totals: 1, queries: 3, pages: 2 }); // 2 named + collector
    expect(facts.queries).toHaveLength(3);
  });
});
