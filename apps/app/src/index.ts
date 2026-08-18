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
import type { WarehouseRepo } from "./repo.ts";

export interface RegistryDeps {
  /** Warehouse-Zugang für die datentragenden Tools. Fehlt er, werden nur Meta-Tools registriert. */
  readonly repo?: WarehouseRepo;
}

/** Baut die Registry mit den derzeit implementierten Tools. */
export function buildRegistry(deps: RegistryDeps = {}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(showPricing);
  registry.register(makeGetCapabilities(registry));
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
  }
  return registry;
}
