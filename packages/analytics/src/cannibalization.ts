/**
 * Kannibalisierung ([docs/06] §5). Mehrere rankende URLs für dieselbe Suchanfrage
 * sind nicht per se ein Problem — schädlich ist die *Instabilität*: wechselt Google
 * wöchentlich die Zielseite, verliert jede Ranking-Signale. Der Score gewichtet den
 * Wechsel deshalb stärker als die reine Streuung; sortiert wird nach dem, was auf dem
 * Spiel steht.
 */

import { ctr, avgPosition, sumFacts, type Fact } from "@gsc/core";
import { expectedCtr, type CtrCurve } from "./ctr-curve.ts";

export interface CannibalInput extends Fact {
  readonly query: string;
  readonly url: string;
  /** Wochenschlüssel (z. B. Montagsdatum), sortierbar. */
  readonly week: string;
}

export interface CannibalOptions {
  readonly minImpressions?: number; // Vorgabe 100 je URL
  readonly minUrls?: number; // Vorgabe 2
  readonly minScore?: number; // Vorgabe 0,3
}

export interface CannibalResult {
  readonly query: string;
  readonly urls: number;
  readonly dispersion: number;
  readonly switchRate: number;
  readonly score: number;
  readonly clicksAtStake: number;
}

export function findCannibalization(
  rows: readonly CannibalInput[],
  curve: CtrCurve,
  opts: CannibalOptions = {},
): CannibalResult[] {
  const minImpressions = opts.minImpressions ?? 100;
  const minUrls = opts.minUrls ?? 2;
  const minScore = opts.minScore ?? 0.3;

  // Nach Query gruppieren.
  const byQuery = new Map<string, CannibalInput[]>();
  for (const row of rows) {
    const list = byQuery.get(row.query) ?? [];
    list.push(row);
    byQuery.set(row.query, list);
  }

  const out: CannibalResult[] = [];
  for (const [query, qRows] of byQuery) {
    // URL-Aggregate.
    const byUrl = new Map<string, Fact[]>();
    for (const r of qRows) {
      const list = byUrl.get(r.url) ?? [];
      list.push(r);
      byUrl.set(r.url, list);
    }
    const urlFacts = new Map<string, Fact>();
    for (const [url, facts] of byUrl) urlFacts.set(url, sumFacts(facts));

    const qualifyingUrls = [...urlFacts.entries()].filter(([, f]) => f.impressions >= minImpressions);
    if (qualifyingUrls.length < minUrls) continue;

    const total = sumFacts([...urlFacts.values()]);
    if (total.impressions === 0) continue;

    // Streuung über den Herfindahl-Index.
    const hhi = [...urlFacts.values()].reduce(
      (s, f) => s + (f.impressions / total.impressions) ** 2,
      0,
    );
    const dispersion = 1 - hhi;

    // Wechselrate: je Woche die impressionsstärkste URL.
    const weeks = new Map<string, Map<string, number>>();
    for (const r of qRows) {
      const w = weeks.get(r.week) ?? new Map<string, number>();
      w.set(r.url, (w.get(r.url) ?? 0) + r.impressions);
      weeks.set(r.week, w);
    }
    const weekKeys = [...weeks.keys()].sort();
    const topPerWeek = weekKeys.map((w) => {
      let best = "";
      let bestImpr = -1;
      for (const [url, impr] of weeks.get(w)!) {
        if (impr > bestImpr) {
          bestImpr = impr;
          best = url;
        }
      }
      return best;
    });
    let switches = 0;
    for (let i = 1; i < topPerWeek.length; i++) {
      if (topPerWeek[i] !== topPerWeek[i - 1]) switches++;
    }
    const switchRate = weekKeys.length > 1 ? switches / (weekKeys.length - 1) : 0;

    const score = 0.6 * switchRate + 0.4 * dispersion;
    if (score < minScore) continue;

    // Was auf dem Spiel steht: Differenz zwischen der stärksten URL allein und der
    // zersplitterten Ist-Situation.
    let bestUrlFact: Fact | undefined;
    for (const f of urlFacts.values()) {
      if (!bestUrlFact || f.impressions > bestUrlFact.impressions) bestUrlFact = f;
    }
    const bestPos = bestUrlFact ? avgPosition(bestUrlFact) : null;
    const bestCtr = bestPos === null ? ctr(total) : expectedCtr(curve, bestPos);
    const clicksAtStake = total.impressions * Math.max(0, bestCtr - ctr(total));

    out.push({
      query,
      urls: qualifyingUrls.length,
      dispersion,
      switchRate,
      score,
      clicksAtStake,
    });
  }

  return out.sort((a, b) => b.clicksAtStake - a.clicksAtStake);
}
