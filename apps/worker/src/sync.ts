/**
 * API-Sync eines Tages ([docs/04]) — der Backfill/Delta-Pfad über die Search-Console-
 * API (der Bulk-Export-Pfad läuft über `ingest.ts`). Kernstück ist `buildDayFacts`: Es
 * rekonstruiert den anonymisierten Sammelposten aus `totals − Σ(named queries)`, sodass
 * `SUM(fact_query) = fact_totals` erhalten bleibt — die API liefert die anonymisierten
 * Anfragen nicht einzeln, nur in den Gesamtwerten.
 *
 * `buildDayFacts` ist rein und testbar; `syncDay` verdrahtet Quelle und Writer.
 */

import type { SearchAnalyticsRow } from "@gsc/gsc-client";
import type { TotalsFactInput, QueryFactInput, PageFactInput, WarehouseWriter } from "@gsc/db";

interface Sums {
  clicks: number;
  impressions: number;
  positionSum: number;
}

/** API-Position ist einsbasiert → positionSum = position × impressions. */
function toSums(row: SearchAnalyticsRow): Sums {
  return { clicks: row.clicks, impressions: row.impressions, positionSum: row.position * row.impressions };
}

function addSums(a: Sums, b: Sums): Sums {
  return {
    clicks: a.clicks + b.clicks,
    impressions: a.impressions + b.impressions,
    positionSum: a.positionSum + b.positionSum,
  };
}

const ZERO: Sums = { clicks: 0, impressions: 0, positionSum: 0 };

export interface DayFacts {
  readonly totals: TotalsFactInput;
  readonly queries: readonly QueryFactInput[];
  readonly pages: readonly PageFactInput[];
}

/**
 * Baut die Schreibeingaben eines Tages. `totalsRows` hat die Dimension [date],
 * `queryRows` [date, query], `pageRows` [date, page]. Der Sammelposten (`query = null`)
 * fängt die Differenz zwischen Gesamtwerten und benannten Anfragen.
 */
export function buildDayFacts(
  day: string,
  searchType: string,
  totalsRows: readonly SearchAnalyticsRow[],
  queryRows: readonly SearchAnalyticsRow[],
  pageRows: readonly SearchAnalyticsRow[],
): DayFacts {
  const totals = totalsRows.map(toSums).reduce(addSums, ZERO);

  const named: QueryFactInput[] = queryRows.map((r) => ({
    query: String(r.keys[1] ?? ""),
    day,
    searchType,
    ...toSums(r),
  }));
  const namedSum = named.map((q) => ({ clicks: q.clicks, impressions: q.impressions, positionSum: q.positionSum })).reduce(addSums, ZERO);

  // Sammelposten = Gesamt − benannt, nie negativ (Rundung).
  const collector: QueryFactInput = {
    query: null,
    day,
    searchType,
    clicks: Math.max(0, totals.clicks - namedSum.clicks),
    impressions: Math.max(0, totals.impressions - namedSum.impressions),
    positionSum: Math.max(0, totals.positionSum - namedSum.positionSum),
  };
  const queries = collector.impressions > 0 || collector.clicks > 0 ? [...named, collector] : named;

  const pages: PageFactInput[] = pageRows.map((r) => ({
    page: String(r.keys[1] ?? ""),
    day,
    searchType,
    ...toSums(r),
  }));

  return { totals: { day, searchType, ...totals }, queries, pages };
}

/** Tagesweise Datenquelle (Search-Console-API, hinter Pagination). */
export interface GscDaySource {
  totals(propertyId: number, day: string, searchType: string): Promise<SearchAnalyticsRow[]>;
  byQuery(propertyId: number, day: string, searchType: string): Promise<SearchAnalyticsRow[]>;
  byPage(propertyId: number, day: string, searchType: string): Promise<SearchAnalyticsRow[]>;
}

/** Was `syncDay` zum Schreiben braucht (eine Teilmenge des WarehouseWriter). */
export type FactWriter = Pick<WarehouseWriter, "writeTotals" | "writeQueryFacts" | "writePageFacts">;

/** Holt einen Tag über die Quelle und schreibt ihn abstimmbar ins Warehouse. */
export async function syncDay(
  writer: FactWriter,
  source: GscDaySource,
  propertyId: number,
  day: string,
  searchType: string,
): Promise<DayFacts> {
  const [totalsRows, queryRows, pageRows] = await Promise.all([
    source.totals(propertyId, day, searchType),
    source.byQuery(propertyId, day, searchType),
    source.byPage(propertyId, day, searchType),
  ]);
  const facts = buildDayFacts(day, searchType, totalsRows, queryRows, pageRows);
  await writer.writeTotals(propertyId, [facts.totals]);
  await writer.writeQueryFacts(propertyId, facts.queries);
  await writer.writePageFacts(propertyId, facts.pages);
  return facts;
}
