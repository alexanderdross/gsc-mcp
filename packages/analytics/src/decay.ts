/**
 * Content Decay ([docs/06] §6): Seiten mit strukturellem, nicht saisonalem
 * Klickverlust. Ein Rückgang zählt nur, wenn er stärker ausfällt als der der ganzen
 * Website — sonst misst man Saisonalität. Ergänzt um einen robusten Theil-Sen-Trend
 * über die Monats-Rollups.
 *
 * Setzt Historie jenseits der 16 Monate voraus und ist auf einem reinen
 * Passthrough-Modell nicht abbildbar ([docs/12]).
 */

import { theilSen } from "./stats.ts";

export interface DecayInput {
  readonly key: string;
  /** Klicks der letzten 90 Tage. */
  readonly recentClicks: number;
  /** Klicks derselben 90 Tage im Vorjahr. */
  readonly priorYearClicks: number;
  /** Monatsklicks, zeitlich aufsteigend (für den Trend). */
  readonly monthly: readonly number[];
}

export interface DecayOptions {
  /** Höchster erlaubter seitenspezifischer YoY, ab dem gemeldet wird. Vorgabe −0,25. */
  readonly maxDecay?: number;
  readonly minPriorClicks?: number; // Vorgabe 100
}

export interface DecayResult {
  readonly key: string;
  readonly pageYoy: number;
  readonly decay: number;
  readonly slope: number;
}

export function contentDecay(
  pages: readonly DecayInput[],
  siteYoy: number,
  opts: DecayOptions = {},
): DecayResult[] {
  const maxDecay = opts.maxDecay ?? -0.25;
  const minPriorClicks = opts.minPriorClicks ?? 100;

  const out: DecayResult[] = [];
  for (const page of pages) {
    if (page.priorYearClicks < minPriorClicks) continue;
    const pageYoy = page.recentClicks / page.priorYearClicks - 1;
    const decay = pageYoy - siteYoy;
    const slope = theilSen(page.monthly.map((y, x) => ({ x, y })));
    if (decay < maxDecay && slope < 0) {
      out.push({ key: page.key, pageYoy, decay, slope });
    }
  }
  // Stärkster Verfall zuerst.
  return out.sort((a, b) => a.decay - b.decay);
}
