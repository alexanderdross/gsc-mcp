/**
 * Change-Attribution ([docs/06] §1). Beantwortet „warum sind die Klicks gefallen?"
 * nicht mit zwei Zahlen, sondern mit einer Zerlegung, die sich exakt zum
 * Gesamteffekt summiert.
 *
 * Symmetrische Zerlegung (der Interaktionsterm hälftig auf beide Faktoren):
 *
 *   Δclicks = Δimpressions × (ctr_a + ctr_b)/2   ← Nachfrage/Sichtbarkeit
 *           + Δctr         × (imp_a + imp_b)/2   ← CTR
 *
 * Diese Form ist algebraisch exakt (die Summe ergibt immer Δclicks), symmetrisch
 * gegenüber der Reihenfolge der Zeiträume und über Segmente additiv. Ein
 * Eigenschaftstest sichert die Exaktheit über zufällige Eingaben ab.
 */

import { ctr, avgPosition, type Fact } from "@gsc/core";
import { expectedCtr, type CtrCurve } from "./ctr-curve.ts";

export interface Decomposition {
  readonly deltaClicks: number;
  /** Beitrag aus veränderter Impressionszahl bei gehaltener CTR. */
  readonly demand: number;
  /** Beitrag aus veränderter CTR bei gehaltener Impressionszahl. */
  readonly ctrEffect: number;
}

/** Zerlegt die Klickveränderung zwischen zwei Zeiträumen a → b. */
export function decompose(a: Fact, b: Fact): Decomposition {
  const deltaImpr = b.impressions - a.impressions;
  const deltaCtr = ctr(b) - ctr(a);
  const meanCtr = (ctr(a) + ctr(b)) / 2;
  const meanImpr = (a.impressions + b.impressions) / 2;

  const demand = deltaImpr * meanCtr;
  const ctrEffect = deltaCtr * meanImpr;

  return { deltaClicks: b.clicks - a.clicks, demand, ctrEffect };
}

export interface CtrSplit {
  /** CTR-Änderung, die dem Positionswechsel entspricht (erwartete Kurve). */
  readonly ranking: number;
  /** Rest: Snippet-Effekt — Titel, Description, Rich Results, AI Overview. */
  readonly snippet: number;
}

/**
 * Spaltet den CTR-Anteil weiter in Ranking- und Snippet-Effekt ([docs/06] §1),
 * gemessen in Klicks. `ranking + snippet` ergibt exakt `ctrEffect`.
 *
 * Mit der site-eigenen CTR-Kurve E(p) und dem Residuum r = ctr − E(p):
 *   Δctr = [E(p_b) − E(p_a)]  (Ranking) + [r_b − r_a]  (Snippet)
 *
 * Kann eine Position nicht bestimmt werden (0 Impressionen), fällt der gesamte
 * CTR-Effekt auf den Snippet-Anteil.
 */
export function splitCtrEffect(a: Fact, b: Fact, curve: CtrCurve): CtrSplit {
  const meanImpr = (a.impressions + b.impressions) / 2;
  const posA = avgPosition(a);
  const posB = avgPosition(b);

  if (posA === null || posB === null) {
    return { ranking: 0, snippet: (ctr(b) - ctr(a)) * meanImpr };
  }

  const rankingCtr = expectedCtr(curve, posB) - expectedCtr(curve, posA);
  const residualA = ctr(a) - expectedCtr(curve, posA);
  const residualB = ctr(b) - expectedCtr(curve, posB);
  const snippetCtr = residualB - residualA;

  return { ranking: rankingCtr * meanImpr, snippet: snippetCtr * meanImpr };
}

export interface SegmentInput {
  readonly key: string;
  readonly a: Fact;
  readonly b: Fact;
}

export interface SegmentContribution extends Decomposition {
  readonly key: string;
}

export interface Attribution {
  readonly total: Decomposition;
  /** Einzelposten, nach Betrag des Beitrags absteigend sortiert. */
  readonly contributors: readonly SegmentContribution[];
}

/**
 * Attribuiert die Gesamtveränderung auf Segmente (Queries, Seiten, …) und sortiert
 * sie nach dem Betrag ihres Klickbeitrags. Weil die Zerlegung über Segmente additiv
 * ist, gilt: die Summe der `deltaClicks` aller Beiträge == `total.deltaClicks`.
 *
 * @param limit optionale Kürzung auf die N stärksten Beiträge; die übrigen werden
 *   als Sammelposten mit key `__other__` zusammengefasst, damit die Summe erhalten bleibt.
 */
export function attributeBySegment(
  segments: readonly SegmentInput[],
  limit?: number,
): Attribution {
  const all: SegmentContribution[] = segments.map((s) => ({
    key: s.key,
    ...decompose(s.a, s.b),
  }));

  all.sort((x, y) => Math.abs(y.deltaClicks) - Math.abs(x.deltaClicks));

  const total: Decomposition = all.reduce<Decomposition>(
    (acc, c) => ({
      deltaClicks: acc.deltaClicks + c.deltaClicks,
      demand: acc.demand + c.demand,
      ctrEffect: acc.ctrEffect + c.ctrEffect,
    }),
    { deltaClicks: 0, demand: 0, ctrEffect: 0 },
  );

  if (limit === undefined || limit >= all.length) {
    return { total, contributors: all };
  }

  const top = all.slice(0, limit);
  const rest = all.slice(limit);
  const other: SegmentContribution = rest.reduce<SegmentContribution>(
    (acc, c) => ({
      key: acc.key,
      deltaClicks: acc.deltaClicks + c.deltaClicks,
      demand: acc.demand + c.demand,
      ctrEffect: acc.ctrEffect + c.ctrEffect,
    }),
    { key: "__other__", deltaClicks: 0, demand: 0, ctrEffect: 0 },
  );

  return { total, contributors: [...top, other] };
}
