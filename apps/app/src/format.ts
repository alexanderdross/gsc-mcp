/**
 * Formatierung der Tool-Antworten ([docs/05]). Antworten tragen immer die
 * abgeleiteten Kennzahlen (CTR, Position), die Herkunft und den Anteil der von
 * Google anonymisierten Impressionen — damit ein Agent Anteile korrekt einordnet
 * statt sie aus der gekürzten Liste zu schätzen.
 */

import { ctr, avgPosition, type Fact } from "@gsc/core";

export interface MetricView {
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number | null;
}

/** Ergänzt eine Faktenzeile um die berechneten Kennzahlen. */
export function view(f: Fact): MetricView {
  return {
    clicks: f.clicks,
    impressions: f.impressions,
    ctr: ctr(f),
    position: avgPosition(f),
  };
}

export interface KeyedView extends MetricView {
  readonly key: string;
}

export function viewRow(row: Fact & { key: string }): KeyedView {
  return { key: row.key, ...view(row) };
}

/**
 * Anteil der Impressionen, die auf von Google anonymisierte Anfragen entfallen.
 * Muss ausgewiesen werden, sonst ergeben Segmentanteile stillschweigend falsche
 * Aussagen ([docs/03], [docs/05]). 0..1; 0 Impressionen ⇒ 0.
 */
export function anonymizedShare(anonymizedImpressions: number, totalImpressions: number): number {
  return totalImpressions === 0 ? 0 : anonymizedImpressions / totalImpressions;
}
