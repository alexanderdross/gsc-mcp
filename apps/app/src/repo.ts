/**
 * Warehouse-Repository — die Schnittstelle, über die datentragende Tool-Handler
 * an ihre Daten kommen ([docs/10]: Datenzugriff ausschließlich über eine
 * Repository-Grenze, kein rohes SQL im Handler). Die echte Implementierung sitzt
 * in `packages/db`; in Tests wird ein Fake injiziert, sodass die Handler-Logik
 * ohne Datenbank prüfbar bleibt.
 */

import type { Fact } from "@gsc/core";

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
  readonly source: Source;
  readonly covered: Period;
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
}
