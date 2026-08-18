/**
 * Abstimmungs-Invariante ([docs/03], [docs/04]): Für jeden Tag muss die Summe der
 * Query-Zeilen (inklusive Sammelposten `query_id = 0`) exakt den Gesamtwerten
 * entsprechen. Bricht das, schlägt ein Pagination- oder Sammelposten-Fehler
 * unbemerkt in jede Segmentauswertung durch.
 *
 * Diese Datei stellt die Abfrage bereit; der Sync-Worker ruft sie nach jedem
 * Delta-Lauf stichprobenartig auf.
 */

import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";

export interface DriftRow {
  day: string;
  searchType: string;
  totalsClicks: number;
  queryClicks: number;
  drift: number;
}

/**
 * Liefert die Tage, an denen `SUM(fact_query.clicks) != fact_totals.clicks`.
 * Eine leere Liste bedeutet: der Bestand stimmt ab.
 */
export async function findClickDrift(
  db: Db,
  propertyId: number,
  from: string,
  to: string,
): Promise<DriftRow[]> {
  const result = await db.execute(sql`
    SELECT t.day::text                             AS day,
           t.search_type                           AS "searchType",
           t.clicks                                AS "totalsClicks",
           COALESCE(SUM(q.clicks), 0)              AS "queryClicks",
           t.clicks - COALESCE(SUM(q.clicks), 0)   AS drift
      FROM wh.fact_totals t
      LEFT JOIN wh.fact_query q
             ON q.property_id = t.property_id
            AND q.day         = t.day
            AND q.search_type = t.search_type
     WHERE t.property_id = ${propertyId}
       AND t.day BETWEEN ${from} AND ${to}
     GROUP BY t.day, t.search_type, t.clicks
    HAVING t.clicks <> COALESCE(SUM(q.clicks), 0)
     ORDER BY t.day
  `);
  return result.rows as unknown as DriftRow[];
}
