import { describe, it, expect } from "vitest";
import { aggregateQueryFacts, aggregatePageFacts, toPositionSum, type UrlImpressionRow } from "../src/index.ts";

const web = "web";

/** url_impression-Zeilen eines Tages: zwei Queries auf zwei Seiten, plus anonymisiert. */
const rows: UrlImpressionRow[] = [
  { day: "2026-08-16", searchType: web, query: "aip", isAnonymizedQuery: false, url: "/a", clicks: 10, impressions: 100, sumTopPosition: 200 },
  { day: "2026-08-16", searchType: web, query: "aip", isAnonymizedQuery: false, url: "/b", clicks: 5, impressions: 50, sumTopPosition: 150 },
  { day: "2026-08-16", searchType: web, query: "aip germany", isAnonymizedQuery: false, url: "/a", clicks: 20, impressions: 300, sumTopPosition: 600 },
  // anonymisiert: kein Text → Sammelposten
  { day: "2026-08-16", searchType: web, query: null, isAnonymizedQuery: true, url: "/a", clicks: 3, impressions: 30, sumTopPosition: 90 },
  { day: "2026-08-16", searchType: web, query: "", isAnonymizedQuery: false, url: "/c", clicks: 2, impressions: 20, sumTopPosition: 40 },
];

describe("aggregateQueryFacts", () => {
  it("aggregiert über URLs je Query und fasst Anonymisierte im Sammelposten zusammen", () => {
    const facts = aggregateQueryFacts(rows);
    const byQuery = new Map(facts.map((f) => [f.query, f]));

    // "aip": über /a und /b summiert
    expect(byQuery.get("aip")).toMatchObject({
      clicks: 15,
      impressions: 150,
      positionSum: toPositionSum(200, 100) + toPositionSum(150, 50),
    });
    // "aip germany": eine URL
    expect(byQuery.get("aip germany")).toMatchObject({ clicks: 20, impressions: 300 });
    // Sammelposten: null-Query und leerer Text zusammengefasst
    expect(byQuery.get(null)).toMatchObject({
      clicks: 5, // 3 + 2
      impressions: 50, // 30 + 20
      positionSum: toPositionSum(90, 30) + toPositionSum(40, 20),
    });
  });

  it("die Summe aller Query-Fakten entspricht der Summe der Rohzeilen (Abstimmung)", () => {
    const facts = aggregateQueryFacts(rows);
    const sum = (arr: readonly { clicks: number; impressions: number }[]) =>
      arr.reduce((s, r) => ({ clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { clicks: 0, impressions: 0 });
    expect(sum(facts)).toEqual(sum(rows));
  });
});

describe("aggregatePageFacts", () => {
  it("aggregiert über Queries je URL", () => {
    const facts = aggregatePageFacts(rows);
    const byUrl = new Map(facts.map((f) => [f.page, f]));
    // /a: aip(10/100) + aip germany(20/300) + anonym(3/30) = 33/430
    expect(byUrl.get("/a")).toMatchObject({ clicks: 33, impressions: 430 });
    expect(byUrl.get("/b")).toMatchObject({ clicks: 5, impressions: 50 });
    expect(byUrl.get("/c")).toMatchObject({ clicks: 2, impressions: 20 });
  });
});
