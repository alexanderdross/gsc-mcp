/**
 * CSV-Serialisierung für Exporte ([docs/05]). Rein und testbar; RFC-4180-konform
 * genug für Tabellenkalkulationen: Felder mit Komma, Anführungszeichen oder
 * Zeilenumbruch werden gequotet, innere Anführungszeichen verdoppelt.
 */

export type CsvValue = string | number | boolean | null | undefined;
export type CsvRecord = Readonly<Record<string, CsvValue>>;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialisiert Datensätze zu CSV. Die Spalten stammen aus den Schlüsseln der
 * ersten Zeile (explizit über `columns` überschreibbar). Leere Eingabe ⇒ leerer String.
 */
export function toCsv(records: readonly CsvRecord[], columns?: readonly string[]): string {
  if (records.length === 0) return "";
  const cols = columns ?? Object.keys(records[0]!);
  const header = cols.map(escapeField).join(",");
  const lines = records.map((r) => cols.map((c) => escapeField(r[c])).join(","));
  return [header, ...lines].join("\n");
}
