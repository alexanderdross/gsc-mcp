/**
 * Kennzahl-Helfer. Sie kapseln die eine Regel, die im gesamten Warehouse gilt:
 * Positionen werden als impressionsgewichtete Summe geführt, nie als Durchschnitt,
 * und die CTR wird nie gespeichert, sondern stets berechnet ([docs/03], [docs/06]).
 */

/** Eine aggregierbare Faktenzeile, wie sie das Warehouse liefert. */
export interface Fact {
  clicks: number;
  impressions: number;
  /** position × impressions, aufsummiert — erlaubt korrekte Aggregation über Zeilen. */
  positionSum: number;
}

/** Click-Through-Rate als Anteil (0..1). 0 Impressionen ⇒ 0, kein NaN. */
export function ctr(f: Pick<Fact, "clicks" | "impressions">): number {
  return f.impressions === 0 ? 0 : f.clicks / f.impressions;
}

/**
 * Impressionsgewichtete Durchschnittsposition. Der Mittelwert von Mittelwerten
 * wäre falsch; deshalb aus der Summe geteilt durch die Impressionen. 0 Impressionen
 * ⇒ null (keine Position definiert).
 */
export function avgPosition(f: Pick<Fact, "impressions" | "positionSum">): number | null {
  return f.impressions === 0 ? null : f.positionSum / f.impressions;
}

/** Summiert Faktenzeilen additiv — die einzige korrekte Art, Fakten zu bündeln. */
export function sumFacts(facts: readonly Fact[]): Fact {
  const total: Fact = { clicks: 0, impressions: 0, positionSum: 0 };
  for (const f of facts) {
    total.clicks += f.clicks;
    total.impressions += f.impressions;
    total.positionSum += f.positionSum;
  }
  return total;
}
