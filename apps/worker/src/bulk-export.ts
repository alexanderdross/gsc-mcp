/**
 * Transformationen der BigQuery-Bulk-Export-Zeilen in Warehouse-Fakten ([docs/04]).
 * Der einzige nicht-triviale Schritt der ganzen Pipeline, deshalb rein gehalten und
 * dicht getestet:
 *   - sum_top_position ist nullbasiert und bereits eine Summe → +impressions ergibt
 *     unsere einsbasierte position_sum
 *   - Search Appearance ist keine Dimension, sondern boolesche Spalten → entpivotieren
 *   - anonymisierte Anfragen tragen keinen Text → Sammelposten query_id = 0
 */

/** Umrechnung der nullbasierten Google-Positionssumme auf unsere einsbasierte. */
export function toPositionSum(sumTopPosition: number, impressions: number): number {
  return sumTopPosition + impressions;
}

export interface Metrics {
  readonly clicks: number;
  readonly impressions: number;
  readonly sumTopPosition: number;
}

/** Bekannte Appearance-Flags des Exports (searchdata_site_impression). */
export const APPEARANCE_FLAGS = [
  "is_amp_top_stories",
  "is_amp_blue_link",
  "is_job_listing",
  "is_job_details",
  "is_tpf_qa",
  "is_tpf_faq",
  "is_tpf_howto",
  "is_weblite",
  "is_action",
  "is_events_listing",
  "is_events_details",
  "is_search_appearance_android_app",
  "is_amp_story",
  "is_amp_image_result",
  "is_video",
  "is_organic_shopping",
  "is_review_snippet",
  "is_special_announcement",
  "is_recipe_feature",
  "is_recipe_rich_snippet",
  "is_subscribed_content",
  "is_page_experience",
  "is_practice_problems",
  "is_math_solvers",
  "is_translated_result",
  "is_edu_q_and_a",
  "is_product_snippets",
  "is_merchant_listings",
  "is_learning_videos",
] as const;

export interface AppearanceRow {
  readonly appearance: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly positionSum: number;
}

/**
 * Entpivotiert die Appearance-Flags einer Export-Zeile: je gesetztem Flag eine
 * fact_appearance-Zeile. Die Kennzahlen der Zeile gelten für jedes gesetzte Flag
 * (eine Impression kann in mehreren Appearances erscheinen — so liefert es Google).
 */
export function pivotAppearance(
  flags: Readonly<Record<string, boolean>>,
  metrics: Metrics,
): AppearanceRow[] {
  const rows: AppearanceRow[] = [];
  for (const flag of APPEARANCE_FLAGS) {
    if (flags[flag]) {
      rows.push({
        appearance: flag,
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        positionSum: toPositionSum(metrics.sumTopPosition, metrics.impressions),
      });
    }
  }
  return rows;
}

export interface RawUrlImpressionRow extends Metrics {
  readonly query: string | null;
  readonly isAnonymizedQuery: boolean;
  readonly url: string;
}

export interface QueryFact {
  /** null ⇒ Sammelposten (query_id = 0). */
  readonly queryText: string | null;
  readonly clicks: number;
  readonly impressions: number;
  readonly positionSum: number;
}

/**
 * Normalisiert eine url_impression-Zeile zu einem Query-Fakt. Anonymisierte
 * Anfragen (kein Text) landen im Sammelposten, sodass die Abstimmungsinvariante
 * SUM(fact_query) = fact_totals erhalten bleibt ([docs/03]).
 */
export function toQueryFact(row: RawUrlImpressionRow): QueryFact {
  const anonymized = row.isAnonymizedQuery || row.query === null || row.query === "";
  return {
    queryText: anonymized ? null : row.query,
    clicks: row.clicks,
    impressions: row.impressions,
    positionSum: toPositionSum(row.sumTopPosition, row.impressions),
  };
}
