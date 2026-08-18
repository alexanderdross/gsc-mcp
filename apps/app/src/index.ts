/**
 * apps/app — MCP-Server und OAuth Authorization Server ([docs/01], [docs/02]).
 *
 * Dieses Gerüst enthält die reinen, testbaren Bausteine: Tool-Rahmen, Registry,
 * Zugriffs-Gate, Antwortbudget und Router. Die netzwerkseitige Verdrahtung —
 * StreamableHTTP-Transport, node-oidc-provider, Google-Anbindung — folgt, sobald
 * die Infrastruktur (Domain, GCP-OAuth-Client) steht. Bis dahin lässt sich der
 * Kern vollständig ohne Netzwerk prüfen.
 */

export * from "./tool.ts";
export * from "./access.ts";
export * from "./budget.ts";
export * from "./registry.ts";
export * from "./router.ts";
export * from "./repo.ts";
export * from "./format.ts";
export { showPricing, makeGetCapabilities } from "./tools/meta.ts";
export { makeSearchPerformance, makeTopMovers } from "./tools/performance.ts";
export { makeComparePeriods } from "./tools/compare.ts";
export {
  makeStrikingDistance,
  makeCtrAnalysis,
  makeBrandVsNonbrand,
  makeDetectAnomalies,
  makeFindCannibalization,
  makeContentDecay,
} from "./tools/analysis.ts";
export * from "./indexing.ts";
export {
  makeInspectUrl,
  makeBulkInspectUrls,
  makeIndexCoverageOverview,
  makeListSitemaps,
  makeSubmitSitemap,
  type IndexingRepo,
  type InspectionBudget,
} from "./tools/indexing.ts";
export {
  IndexingRepository,
  type InspectionQueue,
  type IndexingRepositoryDeps,
} from "./indexing-repo.ts";
export * from "./google-updates.ts";
export * from "./csv.ts";
export * from "./mcp/index.ts";
export * from "./oauth/index.ts";
export * from "./http/index.ts";
export * from "./runtime/index.ts";
export {
  getGoogleUpdates,
  makeExportData,
  type ExportStore,
  type StoredExport,
} from "./tools/context.ts";

import { ToolRegistry } from "./registry.ts";
import { showPricing, makeGetCapabilities } from "./tools/meta.ts";
import { makeSearchPerformance, makeTopMovers } from "./tools/performance.ts";
import { makeComparePeriods } from "./tools/compare.ts";
import {
  makeStrikingDistance,
  makeCtrAnalysis,
  makeBrandVsNonbrand,
  makeDetectAnomalies,
  makeFindCannibalization,
  makeContentDecay,
} from "./tools/analysis.ts";
import {
  makeInspectUrl,
  makeBulkInspectUrls,
  makeIndexCoverageOverview,
  makeListSitemaps,
  makeSubmitSitemap,
  type IndexingRepo,
} from "./tools/indexing.ts";
import { getGoogleUpdates, makeExportData, type ExportStore } from "./tools/context.ts";
import type { WarehouseRepo } from "./repo.ts";

export interface RegistryDeps {
  /** Warehouse-Zugang für die datentragenden Tools. Fehlt er, werden nur Meta-Tools registriert. */
  readonly repo?: WarehouseRepo;
  /** Indexierungs-Zugang (GSC-Client, Cache, Budget) für die Indexierungs-Tools. */
  readonly indexing?: IndexingRepo;
  /** Objektspeicher für `export_data` (präsignierte URLs). Nur mit `repo` wirksam. */
  readonly exportStore?: ExportStore;
}

/** Baut die Registry mit den derzeit implementierten Tools. */
export function buildRegistry(deps: RegistryDeps = {}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(showPricing);
  registry.register(makeGetCapabilities(registry));
  // Kontext ohne I/O — immer verfügbar (auch ohne Property/Repo).
  registry.register(getGoogleUpdates);
  if (deps.repo) {
    registry.register(makeSearchPerformance(deps.repo));
    registry.register(makeTopMovers(deps.repo));
    registry.register(makeComparePeriods(deps.repo));
    registry.register(makeStrikingDistance(deps.repo));
    registry.register(makeCtrAnalysis(deps.repo));
    registry.register(makeBrandVsNonbrand(deps.repo));
    registry.register(makeDetectAnomalies(deps.repo));
    registry.register(makeFindCannibalization(deps.repo));
    registry.register(makeContentDecay(deps.repo));
    if (deps.exportStore) {
      registry.register(makeExportData(deps.repo, deps.exportStore));
    }
  }
  if (deps.indexing) {
    registry.register(makeInspectUrl(deps.indexing));
    registry.register(makeBulkInspectUrls(deps.indexing));
    registry.register(makeIndexCoverageOverview(deps.indexing));
    registry.register(makeListSitemaps(deps.indexing));
    registry.register(makeSubmitSitemap(deps.indexing));
  }
  return registry;
}
