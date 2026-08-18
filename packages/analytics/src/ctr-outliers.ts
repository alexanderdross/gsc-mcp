/**
 * CTR-Ausreißer ([docs/06] §3): Seiten oder Queries, die deutlich unter der
 * site-eigenen CTR-Kurve liegen — typische Ursachen sind schwache Titel und
 * Beschreibungen oder verlorene Rich Results. Gemeldet wird, wer weniger als die
 * Hälfte der positionsüblichen CTR erreicht (r < −0,5·E(p)).
 */

import { ctr, avgPosition, type Fact } from "@gsc/core";
import { fitCtrCurve, expectedCtr, type CtrObservation } from "./ctr-curve.ts";

export interface CtrInput extends Fact {
  readonly key: string;
}

export interface CtrOutlierOptions {
  readonly minImpressions?: number; // Vorgabe 500
  /** Anteil unter E(p), ab dem gemeldet wird. Vorgabe 0,5. */
  readonly factor?: number;
}

export interface CtrOutlier {
  readonly key: string;
  readonly position: number;
  readonly ctr: number;
  readonly expected: number;
  readonly residual: number;
}

export function ctrOutliers(
  rows: readonly CtrInput[],
  opts: CtrOutlierOptions = {},
): CtrOutlier[] {
  const minImpressions = opts.minImpressions ?? 500;
  const factor = opts.factor ?? 0.5;

  const observations: CtrObservation[] = [];
  for (const row of rows) {
    const position = avgPosition(row);
    if (position !== null) observations.push({ ...row, position });
  }
  const curve = fitCtrCurve(observations);

  const out: CtrOutlier[] = [];
  for (const row of rows) {
    if (row.impressions < minImpressions) continue;
    const position = avgPosition(row);
    if (position === null) continue;
    const expected = expectedCtr(curve, position);
    const current = ctr(row);
    const residual = current - expected;
    if (residual < -factor * expected) {
      out.push({ key: row.key, position, ctr: current, expected, residual });
    }
  }
  // Am stärksten unter Erwartung zuerst.
  return out.sort((a, b) => a.residual - b.residual);
}
