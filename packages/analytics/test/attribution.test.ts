import { describe, it, expect } from "vitest";
import type { Fact } from "@gsc/core";
import {
  decompose,
  splitCtrEffect,
  attributeBySegment,
  fitCtrCurve,
  type SegmentInput,
} from "../src/index.ts";

/** Deterministischer LCG, damit ein Fehlschlag reproduzierbar ist (kein Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomFact(rng: () => number): Fact {
  const impressions = Math.floor(rng() * 50_000);
  const clicks = Math.floor(rng() * (impressions + 1));
  const position = 1 + rng() * 40;
  return { clicks, impressions, positionSum: position * impressions };
}

describe("decompose", () => {
  it("zerlegt anhand echter aip.aero-Tageswerte plausibel", () => {
    // 2026-07-20 → 2026-08-16: Klicks 772 → 989, Impressionen 16.666 → 30.607
    const a: Fact = { clicks: 772, impressions: 16_666, positionSum: 16_666 * 7.3 };
    const b: Fact = { clicks: 989, impressions: 30_607, positionSum: 30_607 * 7.8 };
    const d = decompose(a, b);

    expect(d.deltaClicks).toBe(217);
    // Die Impressionen stiegen kräftig, die CTR fiel leicht — der Zuwachs ist
    // fast vollständig Nachfrage, der CTR-Effekt negativ.
    expect(d.demand).toBeGreaterThan(0);
    expect(d.ctrEffect).toBeLessThan(0);
    expect(d.demand + d.ctrEffect).toBeCloseTo(d.deltaClicks, 9);
  });

  it("INVARIANTE: demand + ctrEffect == deltaClicks über 5000 Zufallsfälle", () => {
    const rng = lcg(0x5eed);
    for (let i = 0; i < 5000; i++) {
      const d = decompose(randomFact(rng), randomFact(rng));
      expect(d.demand + d.ctrEffect).toBeCloseTo(d.deltaClicks, 6);
    }
  });

  it("ist symmetrisch: Vertauschen der Zeiträume kehrt jeden Anteil vorzeichengleich um", () => {
    const rng = lcg(42);
    for (let i = 0; i < 500; i++) {
      const a = randomFact(rng);
      const b = randomFact(rng);
      const fwd = decompose(a, b);
      const rev = decompose(b, a);
      expect(rev.demand).toBeCloseTo(-fwd.demand, 6);
      expect(rev.ctrEffect).toBeCloseTo(-fwd.ctrEffect, 6);
    }
  });
});

describe("splitCtrEffect", () => {
  it("ranking + snippet ergibt exakt den ctrEffect", () => {
    const rng = lcg(7);
    const curve = fitCtrCurve(
      Array.from({ length: 40 }, (_, i) => {
        const position = 1 + i;
        const impressions = 5000;
        const clicks = Math.round(impressions * (0.35 / position));
        return { clicks, impressions, positionSum: position * impressions };
      }),
    );
    for (let i = 0; i < 1000; i++) {
      const a = randomFact(rng);
      const b = randomFact(rng);
      const total = decompose(a, b);
      const split = splitCtrEffect(a, b, curve);
      expect(split.ranking + split.snippet).toBeCloseTo(total.ctrEffect, 6);
    }
  });

  it("schreibt bei fehlender Position den gesamten Effekt dem Snippet zu", () => {
    const a: Fact = { clicks: 0, impressions: 0, positionSum: 0 };
    const b: Fact = { clicks: 10, impressions: 100, positionSum: 100 * 3 };
    const split = splitCtrEffect(a, b, []);
    expect(split.ranking).toBe(0);
    expect(split.snippet).toBeCloseTo(decompose(a, b).ctrEffect, 9);
  });
});

describe("attributeBySegment", () => {
  const segments: SegmentInput[] = [
    { key: "a", a: fact(100, 1000, 4), b: fact(60, 900, 5) },
    { key: "b", a: fact(50, 800, 3), b: fact(90, 1200, 2.5) },
    { key: "c", a: fact(20, 400, 6), b: fact(18, 380, 6.2) },
    { key: "d", a: fact(10, 200, 8), b: fact(4, 150, 9) },
  ];

  it("INVARIANTE: Summe der Segment-deltaClicks == total.deltaClicks", () => {
    const { total, contributors } = attributeBySegment(segments);
    const sum = contributors.reduce((s, c) => s + c.deltaClicks, 0);
    expect(sum).toBeCloseTo(total.deltaClicks, 9);
  });

  it("sortiert nach Betrag des Beitrags absteigend", () => {
    const { contributors } = attributeBySegment(segments);
    for (let i = 1; i < contributors.length; i++) {
      expect(Math.abs(contributors[i - 1]!.deltaClicks)).toBeGreaterThanOrEqual(
        Math.abs(contributors[i]!.deltaClicks),
      );
    }
  });

  it("erhält die Summe auch bei Kürzung über den __other__-Sammelposten", () => {
    const { total, contributors } = attributeBySegment(segments, 2);
    expect(contributors).toHaveLength(3); // 2 Top + Sammelposten
    expect(contributors[2]!.key).toBe("__other__");
    const sum = contributors.reduce((s, c) => s + c.deltaClicks, 0);
    expect(sum).toBeCloseTo(total.deltaClicks, 9);
  });
});

function fact(clicks: number, impressions: number, position: number): Fact {
  return { clicks, impressions, positionSum: position * impressions };
}
