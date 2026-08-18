/**
 * Pagination über searchanalytics.query ([docs/04]). Die API liefert höchstens
 * 25.000 Zeilen je Request; vollständige Tage werden über `startRow` seitenweise
 * geholt, bis eine Teilseite (< pageSize) das Ende signalisiert.
 *
 * Die Logik ist als reine Funktion mit injizierbarem Seiten-Abruf gehalten, damit
 * sie ohne Netzwerk getestet werden kann.
 */

import type { SearchAnalyticsRow } from "./types.ts";

export const MAX_PAGE_SIZE = 25_000;

/** Sicherung gegen eine nie endende Schleife bei fehlerhafter API-Antwort. */
const MAX_PAGES = 1000;

export interface Page {
  readonly startRow: number;
  readonly rows: readonly SearchAnalyticsRow[];
}

/**
 * Ruft Seiten ab, bis eine Teilseite kommt, und liefert jede Seite einzeln —
 * so kann der Aufrufer den Cursor (`startRow`) nach jeder Seite persistieren
 * und einen Abbruch dort fortsetzen.
 *
 * @param fetchPage holt die Zeilen ab `startRow` (bis zu `pageSize` Stück)
 */
export async function* paginate(
  fetchPage: (startRow: number, pageSize: number) => Promise<readonly SearchAnalyticsRow[]>,
  pageSize: number = MAX_PAGE_SIZE,
  startRow = 0,
): AsyncGenerator<Page, void, unknown> {
  let cursor = startRow;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchPage(cursor, pageSize);
    yield { startRow: cursor, rows };
    if (rows.length < pageSize) return; // Teilseite ⇒ Ende
    cursor += rows.length;
  }
  throw new Error(`Pagination überschritt ${MAX_PAGES} Seiten — vermutlich ein API-Fehler`);
}

/** Bequemlichkeit: sammelt alle Zeilen über sämtliche Seiten ein. */
export async function collectAll(
  fetchPage: (startRow: number, pageSize: number) => Promise<readonly SearchAnalyticsRow[]>,
  pageSize: number = MAX_PAGE_SIZE,
): Promise<SearchAnalyticsRow[]> {
  const all: SearchAnalyticsRow[] = [];
  for await (const page of paginate(fetchPage, pageSize)) {
    all.push(...page.rows);
  }
  return all;
}
