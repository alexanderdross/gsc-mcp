import { describe, it, expect } from "vitest";
import type { Fact } from "@gsc/core";
import {
  buildRegistry,
  Router,
  type Session,
  type WarehouseRepo,
  type PerfQuery,
  type SegmentPair,
  type Dimension,
  type Period,
} from "../src/index.ts";

function fact(clicks: number, impressions: number, position: number): Fact {
  return { clicks, impressions, positionSum: position * impressions };
}

/** Fake-Repo: liefert kanonische Daten und protokolliert die letzte Abfrage. */
function fakeRepo(data: {
  perf?: (q: PerfQuery) => Awaited<ReturnType<WarehouseRepo["performance"]>>;
  pairs?: SegmentPair[];
}): WarehouseRepo & { lastPerf?: PerfQuery } {
  const repo: WarehouseRepo & { lastPerf?: PerfQuery } = {
    async performance(q) {
      repo.lastPerf = q;
      return (
        data.perf?.(q) ?? {
          rows: [],
          totals: fact(0, 0, 0),
          anonymizedImpressions: 0,
          source: "warehouse",
          covered: q.period,
        }
      );
    },
    async segmentPairs(
      _p: number,
      _d: Dimension,
      _a: Period,
      _b: Period,
      _st: string,
    ) {
      return data.pairs ?? [];
    },
  };
  return repo;
}

const owns = async () => true;

describe("search_performance", () => {
  it("liefert Zeilen mit abgeleiteten Kennzahlen, Herkunft und anonymisiertem Anteil", async () => {
    const repo = fakeRepo({
      perf: (q) => ({
        rows: [
          { key: "aip germany", ...fact(109, 729, 2.8) },
          { key: "aip", ...fact(98, 20898, 7.8) },
        ],
        totals: fact(28982, 767142, 7.5),
        anonymizedImpressions: 700000,
        source: "warehouse",
        covered: q.period,
      }),
    });
    const router = new Router(buildRegistry({ repo }), { ownershipCheck: owns });
    const session: Session = { plan: "pro", userId: 1, propertyId: 7, detail: "standard" };

    const res = await router.run(session, "search_performance", {
      from: "2026-07-20",
      to: "2026-08-16",
      dimension: "query",
    });

    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const out = res.output as {
      source: string;
      totals: { ctr: number };
      anonymizedImpressionsShare: number;
      rows: Array<{ key: string; ctr: number; position: number }>;
    };
    expect(out.source).toBe("warehouse");
    expect(out.rows[0]!.key).toBe("aip germany");
    expect(out.rows[0]!.ctr).toBeCloseTo(109 / 729, 6);
    expect(out.rows[0]!.position).toBeCloseTo(2.8, 6);
    // 700k von 767k Impressionen sind anonymisiert — der ausgewiesene Anteil.
    expect(out.anonymizedImpressionsShare).toBeCloseTo(700000 / 767142, 6);
  });

  it("deckelt die Zeilenzahl auf das Planlimit (free)", async () => {
    const repo = fakeRepo({});
    const router = new Router(buildRegistry({ repo }), { ownershipCheck: owns });
    await router.run(
      { plan: "free", userId: 1, propertyId: 7, detail: "full" },
      "search_performance",
      { from: "2026-08-01", to: "2026-08-01", limit: 9999 },
    );
    // Free: full-Detail (250) durch Planlimit (100) begrenzt.
    expect(repo.lastPerf?.limit).toBe(100);
  });

  it("verlangt eine ausgewählte Property", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo({}) }), { ownershipCheck: owns });
    const res = await router.run({ plan: "pro", userId: 1 }, "search_performance", {
      from: "2026-08-01",
      to: "2026-08-01",
    });
    expect(res.kind).toBe("denied");
  });
});

describe("compare_periods", () => {
  it("zerlegt die Klickveränderung; die Beiträge summieren sich zum Gesamteffekt", async () => {
    // Echte aip.aero-Ränder: 2026-07-20 (772/16666) → 2026-08-16 (989/30607),
    // hier als zwei Segmente modelliert.
    const pairs: SegmentPair[] = [
      { key: "aip germany", a: fact(400, 8000, 3), b: fact(520, 15000, 3.2) },
      { key: "aip", a: fact(372, 8666, 7.8), b: fact(469, 15607, 7.9) },
    ];
    const repo = fakeRepo({ pairs });
    const router = new Router(buildRegistry({ repo }), { ownershipCheck: owns });

    const res = await router.run(
      { plan: "pro", userId: 1, propertyId: 7, detail: "standard" },
      "compare_periods",
      { a: { from: "2026-07-20", to: "2026-07-20" }, b: { from: "2026-08-16", to: "2026-08-16" } },
    );
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const out = res.output as {
      change: { deltaClicks: number; demand: number; ctrEffect: number };
      contributors: Array<{ key: string; deltaClicks: number }>;
    };
    expect(out.change.deltaClicks).toBe(217); // (520+469) - (400+372)
    expect(out.change.demand + out.change.ctrEffect).toBeCloseTo(out.change.deltaClicks, 9);
    const sum = out.contributors.reduce((s, c) => s + c.deltaClicks, 0);
    expect(sum).toBeCloseTo(out.change.deltaClicks, 9);
  });

  it("ist für Starter gesperrt (vollständige Analyse ab Pro)", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo({}) }), { ownershipCheck: owns });
    const res = await router.run(
      { plan: "starter", userId: 1, propertyId: 7 },
      "compare_periods",
      { a: { from: "2026-07-01", to: "2026-07-31" }, b: { from: "2026-08-01", to: "2026-08-31" } },
    );
    expect(res.kind).toBe("denied");
  });
});

describe("top_movers", () => {
  const pairs: SegmentPair[] = [
    { key: "gewinner", a: fact(10, 1000, 8), b: fact(80, 2000, 5) },
    { key: "verlierer", a: fact(90, 1500, 4), b: fact(20, 1400, 9) },
    { key: "rauschen", a: fact(1, 20, 5), b: fact(2, 25, 5) }, // unter min_impressions
  ];

  it("rankt nach Betrag der Klickveränderung und filtert Rauschen", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo({ pairs }) }), { ownershipCheck: owns });
    const res = await router.run(
      { plan: "pro", userId: 1, propertyId: 7, detail: "standard" },
      "top_movers",
      {
        a: { from: "2026-07-01", to: "2026-07-31" },
        b: { from: "2026-08-01", to: "2026-08-31" },
        metric: "clicks",
      },
    );
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const out = res.output as { rows: Array<{ key: string; delta: number }> };
    expect(out.rows.map((r) => r.key)).toEqual(["gewinner", "verlierer"]);
    expect(out.rows[0]!.delta).toBe(70);
  });

  it("filtert nach Richtung: nur Verbesserungen", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo({ pairs }) }), { ownershipCheck: owns });
    const res = await router.run(
      { plan: "pro", userId: 1, propertyId: 7 },
      "top_movers",
      {
        a: { from: "2026-07-01", to: "2026-07-31" },
        b: { from: "2026-08-01", to: "2026-08-31" },
        metric: "clicks",
        direction: "up",
      },
    );
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { rows: Array<{ key: string }> };
    expect(out.rows.map((r) => r.key)).toEqual(["gewinner"]);
  });

  it("ist für Free gesperrt (Basis-Analyse ab Starter)", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo({ pairs }) }), { ownershipCheck: owns });
    const res = await router.run(
      { plan: "free", userId: 1, propertyId: 7 },
      "top_movers",
      {
        a: { from: "2026-07-01", to: "2026-07-31" },
        b: { from: "2026-08-01", to: "2026-08-31" },
      },
    );
    expect(res.kind).toBe("denied");
  });
});

describe("Registry", () => {
  it("registriert Datentools nur mit Repo", () => {
    expect(buildRegistry().size).toBe(2); // nur Meta
    expect(buildRegistry({ repo: fakeRepo({}) }).size).toBe(5);
  });
});
