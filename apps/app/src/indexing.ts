/**
 * Indexierungs-Bausteine ([docs/05], [docs/04]). Die reine Logik — Budget-Planung
 * für Massen-Inspektionen und die Aggregation zum Coverage-Überblick — getrennt von
 * Client und Datenbank, damit sie ohne beides testbar ist. Die I/O-Details
 * (GSC-Client, Cache, Tagesbudget) liegen hinter `IndexingRepo`.
 */

export interface InspectionRecord {
  readonly url: string;
  readonly verdict?: string; // PASS | PARTIAL | FAIL | NEUTRAL
  readonly coverageState?: string;
  readonly indexingState?: string;
  readonly lastCrawl?: string;
}

export interface Sitemap {
  readonly path: string;
  readonly isPending?: boolean;
  readonly isIndex?: boolean;
  readonly warnings?: number;
  readonly errors?: number;
}

export interface BatchPlan {
  readonly planned: readonly string[];
  readonly deferred: number;
}

/**
 * Plant eine Massen-Inspektion gegen das verbleibende Tagesbudget ([docs/04]).
 * `candidates` ist bereits nach Priorität sortiert. Es werden so viele eingeplant,
 * wie Budget und `maxUrls` zulassen; der Rest wird ausdrücklich zurückgestellt —
 * ein stiller Deckel würde als „alles geprüft" gelesen.
 */
export function planInspectionBatch(
  candidates: readonly string[],
  budgetRemaining: number,
  maxUrls?: number,
): BatchPlan {
  const cap = Math.max(0, Math.min(budgetRemaining, maxUrls ?? candidates.length, candidates.length));
  return { planned: candidates.slice(0, cap), deferred: candidates.length - cap };
}

export type CoverageGroupBy = "verdict" | "coverage_state" | "directory";

export interface CoverageBucket {
  readonly key: string;
  readonly count: number;
}

/** Erstes Pfadsegment einer URL als Verzeichnis; „/" für die Wurzel. */
export function directoryOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const seg = path.split("/").filter(Boolean)[0];
    return seg ? `/${seg}` : "/";
  } catch {
    return "/";
  }
}

/**
 * Aggregiert gespeicherte Inspektionen zum Überblick. Fehlt der gruppierende Wert,
 * fällt die Zeile in den Bucket „unbekannt" — er wird nicht verschwiegen. Absteigend
 * nach Häufigkeit.
 */
export function summarizeCoverage(
  records: readonly InspectionRecord[],
  groupBy: CoverageGroupBy,
): CoverageBucket[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const key =
      groupBy === "verdict"
        ? r.verdict ?? "unbekannt"
        : groupBy === "coverage_state"
          ? r.coverageState ?? "unbekannt"
          : directoryOf(r.url);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
