/**
 * Warehouse-Port für die Tool-Handler ([docs/10]: Datenzugriff ausschließlich über
 * eine Repository-Grenze, kein rohes SQL im Handler).
 *
 * Die Schnittstelle und ihre Typen leben in `packages/db` neben der konkreten
 * Implementierung (`WarehouseRepository`); hier werden sie nur re-exportiert, damit die
 * Handler und Tests weiterhin aus dem App-Paket importieren. In Tests wird ein Fake
 * injiziert, sodass die Handler-Logik ohne Datenbank prüfbar bleibt.
 */

export type {
  Dimension,
  Source,
  Period,
  PerfRow,
  PerfQuery,
  PerfResult,
  DecayInputs,
  SegmentPair,
  CtrPoint,
  ExportDataset,
  ExportRow,
  WarehouseRepo,
} from "@gsc/db";
