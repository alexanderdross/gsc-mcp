/**
 * Job-Planung für Backfill und Delta-Sync ([docs/04]). Reine Funktionen: sie
 * erzeugen die Auftragsbeschreibungen, führen sie aber nicht aus. So lässt sich die
 * Reihenfolge — nach Nutzwert, nicht chronologisch — ohne Netzwerk prüfen.
 */

export type Grain =
  | "totals"
  | "query"
  | "page"
  | "query_page"
  | "geo_device"
  | "appearance";

export const PRIORITY = {
  live: 10,
  delta: 50,
  hourly: 80,
  backfill: 200,
} as const;

export interface Job {
  readonly grain: Grain;
  readonly searchType: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly priority: number;
  /** Reihenfolge innerhalb einer Klasse; kleiner = zuerst. */
  readonly seq: number;
}

/** Verschiebt ein ISO-Datum (YYYY-MM-DD) um `days` Tage. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Alle Tage von `to` rückwärts bis `from`, jüngster zuerst. */
export function eachDayDesc(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) days.push(d);
  return days;
}

export interface BackfillRequest {
  readonly from: string;
  readonly to: string;
  readonly grains: readonly Grain[];
  readonly searchTypes: readonly string[];
}

/**
 * Plant den Backfill in Nutzwert-Reihenfolge ([docs/04]):
 * totals → query/page (neueste Tage zuerst) → geo/appearance → query_page zuletzt.
 * Die per-Tag-Grains erzeugen einen Job je Tag (paginiert), damit ein Abbruch
 * tageweise fortsetzbar ist.
 */
export function planBackfill(req: BackfillRequest): Job[] {
  const jobs: Job[] = [];
  let seq = 0;
  const has = (g: Grain) => req.grains.includes(g);
  const p = PRIORITY.backfill;

  for (const st of req.searchTypes) {
    if (has("totals")) {
      jobs.push({ grain: "totals", searchType: st, dateFrom: req.from, dateTo: req.to, priority: p, seq: seq++ });
    }
  }
  for (const grain of ["query", "page"] as const) {
    if (!has(grain)) continue;
    for (const st of req.searchTypes) {
      for (const day of eachDayDesc(req.from, req.to)) {
        jobs.push({ grain, searchType: st, dateFrom: day, dateTo: day, priority: p, seq: seq++ });
      }
    }
  }
  for (const grain of ["geo_device", "appearance"] as const) {
    if (!has(grain)) continue;
    for (const st of req.searchTypes) {
      jobs.push({ grain, searchType: st, dateFrom: req.from, dateTo: req.to, priority: p, seq: seq++ });
    }
  }
  if (has("query_page")) {
    for (const st of req.searchTypes) {
      for (const day of eachDayDesc(req.from, req.to)) {
        jobs.push({ grain: "query_page", searchType: st, dateFrom: day, dateTo: day, priority: p, seq: seq++ });
      }
    }
  }
  return jobs;
}

/**
 * Plant den täglichen Delta-Sync: die letzten `lookbackDays` Tage neu holen,
 * nicht nur den neuesten — GSC korrigiert Daten mehrere Tage nach ([docs/04]).
 */
export function planDelta(
  today: string,
  grains: readonly Grain[],
  searchTypes: readonly string[],
  lookbackDays = 5,
): Job[] {
  const from = addDays(today, -(lookbackDays - 1));
  const jobs: Job[] = [];
  let seq = 0;
  for (const grain of grains) {
    for (const st of searchTypes) {
      jobs.push({ grain, searchType: st, dateFrom: from, dateTo: today, priority: PRIORITY.delta, seq: seq++ });
    }
  }
  return jobs;
}
