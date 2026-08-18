/**
 * Striking Distance ([docs/06] §4): Suchanfragen knapp außerhalb der Sichtbarkeit,
 * mit Klickpotenzial-Schätzung auf Basis der site-eigenen CTR-Kurve statt einer
 * generischen Branchentabelle. Das Zielniveau ist bewusst zurückhaltend (Position 3,
 * nicht 1), damit die Potenzialzahlen einlösbar bleiben.
 */

import { ctr, avgPosition, type Fact } from "@gsc/core";
import { expectedCtr, type CtrCurve } from "./ctr-curve.ts";

export interface StrikingInput extends Fact {
  readonly key: string;
}

export interface StrikingOptions {
  readonly positionMin?: number; // Vorgabe 5
  readonly positionMax?: number; // Vorgabe 20
  readonly minImpressions?: number; // Vorgabe 100
  readonly targetPosition?: number; // Vorgabe 3
}

export interface StrikingResult {
  readonly key: string;
  readonly position: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly potentialClicks: number;
}

export function strikingDistance(
  rows: readonly StrikingInput[],
  curve: CtrCurve,
  opts: StrikingOptions = {},
): StrikingResult[] {
  const positionMin = opts.positionMin ?? 5;
  const positionMax = opts.positionMax ?? 20;
  const minImpressions = opts.minImpressions ?? 100;
  const targetCtr = expectedCtr(curve, opts.targetPosition ?? 3);

  const out: StrikingResult[] = [];
  for (const row of rows) {
    const position = avgPosition(row);
    if (position === null || position < positionMin || position > positionMax) continue;
    if (row.impressions < minImpressions) continue;
    const current = ctr(row);
    const potentialClicks = row.impressions * Math.max(0, targetCtr - current);
    if (potentialClicks <= 0) continue;
    out.push({ key: row.key, position, impressions: row.impressions, ctr: current, potentialClicks });
  }
  // Nach absolutem Klickpotenzial, nicht nach Position.
  return out.sort((a, b) => b.potentialClicks - a.potentialClicks);
}
