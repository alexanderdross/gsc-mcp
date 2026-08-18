/**
 * Antwortbudget ([docs/05]). Antworten sind für ein Sprachmodell bestimmt, nicht
 * für eine Tabellenkalkulation: Jede gekürzte Liste trägt einen ausdrücklichen
 * Hinweis mit Anzahl der ausgelassenen Zeilen. Die Gesamtwerte gehören immer dazu,
 * damit der Agent Anteile korrekt berechnet, statt sie aus der gekürzten Liste zu
 * schätzen — das erledigt der jeweilige Handler, nicht diese Funktion.
 */

import { entitlementFor, type Plan } from "@gsc/core";
import type { Detail } from "./tool.ts";

/** Zeilendeckel je Detailstufe. */
const DETAIL_ROWS: Record<Detail, number> = {
  summary: 10,
  standard: 50,
  full: 250,
};

export interface Budgeted<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly omitted: number;
  /** Nur gesetzt, wenn gekürzt wurde — zur wörtlichen Weitergabe. */
  readonly note?: string;
}

/**
 * Kürzt eine Zeilenliste auf das Minimum aus Detailstufe und Planlimit.
 * Deckelt, statt abzuweisen: Der Aufrufer bekommt die ersten N Zeilen plus Hinweis.
 */
export function applyBudget<T>(rows: readonly T[], plan: Plan, detail: Detail): Budgeted<T> {
  const cap = Math.min(DETAIL_ROWS[detail], entitlementFor(plan).rowLimit);
  const total = rows.length;

  if (total <= cap) {
    return { rows, total, omitted: 0 };
  }

  const omitted = total - cap;
  return {
    rows: rows.slice(0, cap),
    total,
    omitted,
    note: `${omitted} weitere Zeilen ausgelassen (${total} gesamt). Filter verfeinern oder detail='full' setzen.`,
  };
}

export function rowCap(plan: Plan, detail: Detail): number {
  return Math.min(DETAIL_ROWS[detail], entitlementFor(plan).rowLimit);
}
