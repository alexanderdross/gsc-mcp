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
export { showPricing, makeGetCapabilities } from "./tools/meta.ts";

import { ToolRegistry } from "./registry.ts";
import { showPricing, makeGetCapabilities } from "./tools/meta.ts";

/** Baut die Registry mit den derzeit implementierten Tools. */
export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(showPricing);
  registry.register(makeGetCapabilities(registry));
  return registry;
}
