/**
 * Meta-Tools ([docs/05]). Reine Handler ohne Datenbank- oder Netzwerkzugriff —
 * sie beweisen das Gerüst und sind vollständig testbar. `get_capabilities` meldet das
 * maßgebliche Tool-Inventar samt Plan-Verfügbarkeit.
 */

import { z } from "zod";
import { PLANS, entitlementFor, type Plan } from "@gsc/core";
import { defineTool } from "../tool.ts";
import { checkAccess } from "../access.ts";
import type { ToolRegistry } from "../registry.ts";

export const showPricing = defineTool({
  name: "show_pricing",
  annotations: { title: "Preise anzeigen", readOnlyHint: true },
  input: z.object({}).strict(),
  requires: {},
  async handler() {
    return {
      plans: PLANS.map((plan) => {
        const e = entitlementFor(plan);
        return {
          plan,
          properties: e.propertiesMax,
          historyDays: e.historyDays,
          source: e.source,
          rowLimit: e.rowLimit,
          alerts: e.alerts,
        };
      }),
      url: "https://gsc2mcp.drossmedia.de/pricing",
    };
  },
});

/**
 * Fabrik für get_capabilities: Braucht die Registry, um das maßgebliche Inventar
 * zu melden — welche Tools der aktuelle Plan aufrufen darf ([docs/05]).
 */
export function makeGetCapabilities(registry: ToolRegistry) {
  return defineTool({
    name: "get_capabilities",
    annotations: { title: "Fähigkeiten", readOnlyHint: true },
    input: z.object({}).strict(),
    requires: {},
    async handler(ctx) {
      const plan: Plan = ctx.plan;
      return {
        plan,
        tools: registry.list().map((t) => ({
          name: t.name,
          title: t.annotations.title,
          readOnly: t.annotations.readOnlyHint,
          available: checkAccess(plan, t.requires).ok,
        })),
      };
    },
  });
}
