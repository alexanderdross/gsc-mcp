/**
 * Katalog bestätigter Google-Ranking-Updates ([docs/05]). Zur Korrelation mit
 * Traffic-Auffälligkeiten — `detect_anomalies` kann später dieselbe Liste nutzen,
 * um eine zeitliche Koinzidenz zu benennen (nicht als bewiesene Ursache).
 *
 * Eine gepflegte Referenzliste, kein Live-Feed. Neue Updates werden hier ergänzt;
 * die Datumsangaben sind die von Google genannten Start-/Enddaten (UTC).
 */

export type UpdateType = "core" | "spam" | "discover" | "other";

export interface GoogleUpdate {
  readonly name: string;
  readonly type: UpdateType;
  readonly start: string; // YYYY-MM-DD
  readonly end?: string; // fehlt = eintägig/laufend
}

/** Auswahl bekannter, bestätigter Updates. Bei Bedarf erweitern. */
export const GOOGLE_UPDATES: readonly GoogleUpdate[] = [
  { name: "March 2024 Core Update", type: "core", start: "2024-03-05", end: "2024-04-19" },
  { name: "March 2024 Spam Update", type: "spam", start: "2024-03-05", end: "2024-03-20" },
  { name: "August 2024 Core Update", type: "core", start: "2024-08-15", end: "2024-09-03" },
  { name: "November 2024 Core Update", type: "core", start: "2024-11-11", end: "2024-12-05" },
  { name: "December 2024 Core Update", type: "core", start: "2024-12-12", end: "2024-12-18" },
  { name: "December 2024 Spam Update", type: "spam", start: "2024-12-19", end: "2024-12-26" },
  { name: "March 2025 Core Update", type: "core", start: "2025-03-13", end: "2025-03-27" },
  { name: "June 2025 Core Update", type: "core", start: "2025-06-30", end: "2025-07-17" },
];

/**
 * Updates, die sich mit dem Zeitraum [from, to] überschneiden. Optional nach Typ
 * gefiltert. Ein Update ohne `end` gilt als eintägig (start).
 */
export function googleUpdatesBetween(
  updates: readonly GoogleUpdate[],
  from: string,
  to: string,
  type?: UpdateType,
): GoogleUpdate[] {
  return updates
    .filter((u) => (type ? u.type === type : true))
    .filter((u) => u.start <= to && (u.end ?? u.start) >= from)
    .sort((a, b) => a.start.localeCompare(b.start));
}
