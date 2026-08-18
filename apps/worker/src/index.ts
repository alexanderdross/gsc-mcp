/**
 * apps/worker — Sync ([docs/01], [docs/04]).
 *
 * Dieses Gerüst enthält die reinen Bausteine: Rate-Limiter-Rechenlogik,
 * Job-Planung, die Bulk-Export-Transformationen und die Aggregation zu
 * Warehouse-Schreibeingaben (`ingest.ts`, gegen `@gsc/db`). Die Verdrahtung —
 * pg-boss, systemd-Timer, der laufende GSC-Client und die BigQuery-Anbindung —
 * folgt, sobald Datenbank und Google-Zugang stehen. Bis dahin ist der Kern ohne
 * Netzwerk prüfbar.
 */

export * from "./rate-limit.ts";
export * from "./planner.ts";
export * from "./bulk-export.ts";
export * from "./ingest.ts";
