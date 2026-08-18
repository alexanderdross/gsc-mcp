/**
 * Warehouse-Port ([docs/10]): die Schnittstelle, über die datentragende Tool-Handler
 * an ihre Daten kommen — kein rohes SQL im Handler. Die Typen leben hier in
 * `packages/db`, weil hier auch die konkrete Implementierung sitzt
 * (`repositories/warehouse-repo.ts`); `apps/app` re-exportiert sie über seine
 * `repo.ts`, sodass die Handler eine stabile, datenbankfreie Sicht behalten und in
 * Tests ein Fake injiziert werden kann.
 */

import type { Fact } from "@gsc/core";
import type { SeriesPoint, CannibalInput, DecayInput } from "@gsc/analytics";

/** Datasets für den flachen Export. */
export type ExportDataset = "query" | "page" | "query_page" | "totals";

/** Eine flache Exportzeile — Spaltenname → Wert (nie `undefined`). */
export type ExportRow = Readonly<Record<string, string | number | boolean | null>>;

export type Dimension = "query" | "page" | "country" | "device";
export type Source = "warehouse" | "live" | "mixed";

export interface Period {
  readonly from: string; // YYYY-MM-DD
  readonly to: string;
}

export interface PerfRow extends Fact {
  /** Ausprägung der Dimension, z. B. der Query-Text oder die URL. */
  readonly key: string;
}

export interface PerfQuery {
  readonly propertyId: number;
  readonly dimension: Dimension;
  readonly period: Period;
  readonly searchType: string;
  readonly queryContains?: string;
  readonly sortBy?: "clicks" | "impressions" | "position";
  readonly limit: number;
}

export interface PerfResult {
  readonly rows: readonly PerfRow[];
  /** Gesamtwerte des Zeitraums — Bezugsgröße für Anteile. */
  readonly totals: Fact;
  /** Impressionen der von Google anonymisierten Anfragen (Sammelposten). */
  readonly anonymizedImpressions: number;
  /** Der Sammelposten als vollständiger Fakt — für brand_vs_nonbrand. */
  readonly anonymized?: Fact;
  readonly source: Source;
  readonly covered: Period;
}

/** Eingaben für content_decay: Seitenwerte plus der Site-YoY als Referenz. */
export interface DecayInputs {
  readonly pages: readonly DecayInput[];
  readonly siteYoy: number;
}

export interface SegmentPair {
  readonly key: string;
  readonly a: Fact;
  readonly b: Fact;
}

/** Faktenzeilen für die CTR-Kurven-Schätzung (Position je Zeile). */
export interface CtrPoint extends Fact {
  readonly position: number;
}

export interface WarehouseRepo {
  /** Top-Zeilen einer Dimension plus Gesamtwerte und anonymisierter Anteil. */
  performance(q: PerfQuery): Promise<PerfResult>;

  /**
   * Segment-Fakten für zwei Zeiträume, ausgerichtet je Schlüssel — Grundlage der
   * Change-Attribution und von top_movers. Fehlt ein Segment in einem Zeitraum,
   * liefert der Repo dort Nullwerte.
   */
  segmentPairs(
    propertyId: number,
    dimension: Dimension,
    a: Period,
    b: Period,
    searchType: string,
  ): Promise<readonly SegmentPair[]>;

  /** Tägliche Klick-Zeitreihe — Grundlage von detect_anomalies. */
  timeseries(propertyId: number, period: Period, searchType: string): Promise<readonly SeriesPoint[]>;

  /** Query×URL×Woche-Zeilen — Grundlage von find_cannibalization. */
  cannibalizationRows(
    propertyId: number,
    period: Period,
    searchType: string,
  ): Promise<readonly CannibalInput[]>;

  /** Seiten- und Site-YoY-Werte — Grundlage von content_decay. */
  decayInputs(propertyId: number, searchType: string): Promise<DecayInputs>;

  /** Flache Datensätze eines Datasets für den Export. */
  exportDataset(
    propertyId: number,
    dataset: ExportDataset,
    period: Period,
  ): Promise<readonly ExportRow[]>;
}
