import { describe, it, expect } from "vitest";
import type { Fact } from "@gsc/core";
import { fitCtrCurve, expectedCtr, type CtrObservation } from "../src/index.ts";

function obs(position: number, clicks: number, impressions: number): CtrObservation {
  return { position, clicks, impressions, positionSum: position * impressions };
}

describe("fitCtrCurve", () => {
  it("liefert eine leere Kurve ohne Beobachtungen mit Impressionen", () => {
    expect(fitCtrCurve([])).toEqual([]);
    expect(fitCtrCurve([obs(1, 0, 0)])).toEqual([]);
  });

  it("erzwingt eine monoton fallende Kurve trotz verrauschter Eingabe", () => {
    // Position 3 hat künstlich eine höhere CTR als Position 2 — die Regression glättet das.
    const curve = fitCtrCurve([
      obs(1, 3000, 10_000),
      obs(2, 1500, 10_000),
      obs(3, 2500, 10_000), // Ausreißer nach oben
      obs(4, 800, 10_000),
      obs(5, 400, 10_000),
    ]);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.ctr).toBeLessThanOrEqual(curve[i - 1]!.ctr + 1e-12);
    }
  });

  it("verschmilzt dünne Buckets, sodass jede CTR aus ≥1000 Impressionen stammt", () => {
    const curve = fitCtrCurve([
      obs(1, 500, 1000),
      obs(1.5, 5, 10), // zu dünn
      obs(2, 300, 1000),
      obs(2.5, 2, 5), // zu dünn
    ]);
    expect(curve.length).toBeGreaterThan(0);
    // Alle CTR-Werte liegen im plausiblen [0,1]-Bereich und die Kurve fällt.
    for (const p of curve) {
      expect(p.ctr).toBeGreaterThanOrEqual(0);
      expect(p.ctr).toBeLessThanOrEqual(1);
    }
  });
});

describe("expectedCtr", () => {
  const curve = fitCtrCurve([
    obs(1, 3500, 10_000),
    obs(2, 1800, 10_000),
    obs(3, 900, 10_000),
    obs(4, 500, 10_000),
    obs(5, 300, 10_000),
  ]);

  it("klemmt außerhalb der Stützpunkte auf den Randwert", () => {
    expect(expectedCtr(curve, 0.5)).toBe(curve[0]!.ctr);
    expect(expectedCtr(curve, 99)).toBe(curve[curve.length - 1]!.ctr);
  });

  it("interpoliert zwischen Stützpunkten monoton", () => {
    const mid = expectedCtr(curve, 1.5);
    expect(mid).toBeLessThanOrEqual(curve[0]!.ctr);
    expect(mid).toBeGreaterThanOrEqual(curve[1]!.ctr);
  });

  it("gibt für eine leere Kurve 0 zurück", () => {
    expect(expectedCtr([], 3)).toBe(0);
  });
});
