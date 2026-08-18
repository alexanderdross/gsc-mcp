/**
 * Brand-/Non-Brand-Segmentierung ([docs/06] §7). Drei Kategorien, nicht zwei: Marke,
 * Nicht-Marke und *nicht zugeordnet*. Die dritte enthält die von Google anonymisierten
 * Impressionen; sie einer Seite zuzuschlagen oder aus dem Nenner zu nehmen, verfälscht
 * den Non-Brand-Anteil.
 */

import { sumFacts, ctr, type Fact } from "@gsc/core";

export interface BrandInput extends Fact {
  readonly key: string;
}

export interface Segment extends Fact {
  readonly ctr: number;
  /** Anteil an den Gesamtimpressionen (inkl. nicht zugeordnet). */
  readonly impressionShare: number;
}

export interface BrandSplit {
  readonly brand: Segment;
  readonly nonBrand: Segment;
  readonly unassigned: Segment;
}

/**
 * @param anonymized aggregierte Kennzahlen der anonymisierten Anfragen (Sammelposten)
 */
export function brandSplit(
  rows: readonly BrandInput[],
  pattern: RegExp,
  anonymized: Fact,
): BrandSplit {
  const brandFacts: Fact[] = [];
  const nonBrandFacts: Fact[] = [];
  for (const row of rows) {
    (pattern.test(row.key) ? brandFacts : nonBrandFacts).push(row);
  }
  const brand = sumFacts(brandFacts);
  const nonBrand = sumFacts(nonBrandFacts);
  const totalImpr = brand.impressions + nonBrand.impressions + anonymized.impressions;

  const seg = (f: Fact): Segment => ({
    ...f,
    ctr: ctr(f),
    impressionShare: totalImpr === 0 ? 0 : f.impressions / totalImpr,
  });

  return { brand: seg(brand), nonBrand: seg(nonBrand), unassigned: seg(anonymized) };
}
