/**
 * Plan-Matrix und Entitlement-Auflösung ([docs/07]). Eine einzige Quelle der
 * Wahrheit, aus der der Tool-Router vor jedem Handler ableitet, was erlaubt ist.
 * Preise und Grenzen sind vor dem Livegang gegen den Marktstand zu prüfen ([docs/12]);
 * die Struktur bleibt davon unberührt.
 */

export const PLANS = ["free", "starter", "pro", "agency"] as const;
export type Plan = (typeof PLANS)[number];

/** Namen der planabhängig geschalteten Analyse-Tools. */
export type AnalysisTool =
  | "top_movers"
  | "striking_distance"
  | "brand_vs_nonbrand"
  | "detect_anomalies"
  | "compare_periods"
  | "find_cannibalization"
  | "ctr_analysis"
  | "content_decay";

const BASIS_ANALYSIS: readonly AnalysisTool[] = [
  "top_movers",
  "striking_distance",
  "brand_vs_nonbrand",
];

const FULL_ANALYSIS: readonly AnalysisTool[] = [
  ...BASIS_ANALYSIS,
  "detect_anomalies",
  "compare_periods",
  "find_cannibalization",
  "ctr_analysis",
  "content_decay",
];

/** Was ein Plan gewährt. Vom Tool-Router pro Aufruf ausgewertet. */
export interface Entitlement {
  readonly plan: Plan;
  readonly propertiesMax: number | "unlimited";
  /** Historie in Tagen; "unlimited" ab Sync-Start. */
  readonly historyDays: number | "unlimited";
  /** Datenquelle: reiner Live-Passthrough, API-Warehouse, oder zusätzlich Bulk Export. */
  readonly source: "live" | "warehouse" | "warehouse+bulk";
  readonly syncCadence: "none" | "daily" | "hourly";
  /** Query×Page-Auflösung im Warehouse. */
  readonly queryPageGrain: "none" | "weekly" | "daily";
  /** Zeilendeckel je Tool-Antwort. */
  readonly rowLimit: number;
  readonly urlInspectPerDay: number;
  readonly analysis: readonly AnalysisTool[];
  readonly hourlyData: boolean;
  readonly export: boolean;
  readonly alerts: boolean;
  readonly teamSeats: number;
  readonly whiteLabel: boolean;
}

const ENTITLEMENTS: Record<Plan, Entitlement> = {
  free: {
    plan: "free",
    propertiesMax: 1,
    historyDays: 30,
    source: "live",
    syncCadence: "none",
    queryPageGrain: "none",
    rowLimit: 100,
    urlInspectPerDay: 10,
    analysis: [],
    hourlyData: false,
    export: false,
    alerts: false,
    teamSeats: 0,
    whiteLabel: false,
  },
  starter: {
    plan: "starter",
    propertiesMax: 3,
    historyDays: 488, // 16 Monate
    source: "warehouse",
    syncCadence: "daily",
    queryPageGrain: "weekly",
    rowLimit: 1000,
    urlInspectPerDay: 200,
    analysis: BASIS_ANALYSIS,
    hourlyData: false,
    export: true,
    alerts: false,
    teamSeats: 0,
    whiteLabel: false,
  },
  pro: {
    plan: "pro",
    propertiesMax: 15,
    historyDays: "unlimited",
    source: "warehouse+bulk",
    syncCadence: "hourly",
    queryPageGrain: "daily",
    rowLimit: 5000,
    urlInspectPerDay: 2000,
    analysis: FULL_ANALYSIS,
    hourlyData: true,
    export: true,
    alerts: true,
    teamSeats: 2,
    whiteLabel: false,
  },
  agency: {
    plan: "agency",
    propertiesMax: "unlimited",
    historyDays: "unlimited",
    source: "warehouse+bulk",
    syncCadence: "hourly",
    queryPageGrain: "daily",
    rowLimit: 5000,
    urlInspectPerDay: 2000, // je Property
    analysis: FULL_ANALYSIS,
    hourlyData: true,
    export: true,
    alerts: true,
    teamSeats: 10,
    whiteLabel: true,
  },
};

export function entitlementFor(plan: Plan): Entitlement {
  return ENTITLEMENTS[plan];
}

/** Darf dieser Plan das genannte Analyse-Tool aufrufen? */
export function allowsAnalysis(plan: Plan, tool: AnalysisTool): boolean {
  return ENTITLEMENTS[plan].analysis.includes(tool);
}

/**
 * Deckelt eine gewünschte Zeilenzahl auf das Planlimit. Der Router liefert dann
 * die gekürzte Antwort plus Hinweis, statt die Anfrage abzuweisen ([docs/05]).
 */
export function capRows(plan: Plan, requested: number): number {
  return Math.min(requested, ENTITLEMENTS[plan].rowLimit);
}
