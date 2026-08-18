/**
 * Zugriffs-Gate ([docs/05], [docs/07]). Prüft zentral, ob ein Plan ein Tool aufrufen
 * darf, und liefert bei Ablehnung eine strukturierte, wörtlich weiterzugebende
 * Meldung mit Upgrade-Hinweis — kein technischer Fehler.
 */

import { PLANS, allowsAnalysis, type Plan } from "@gsc/core";
import type { Requirement } from "./tool.ts";

const RANK: Record<Plan, number> = Object.fromEntries(
  PLANS.map((p, i) => [p, i]),
) as Record<Plan, number>;

export function planRank(plan: Plan): number {
  return RANK[plan];
}

/** Kleinster Plan, der die Voraussetzung erfüllt — für die Upgrade-Meldung. */
function requiredPlan(req: Requirement): Plan {
  if (req.analysisTool) {
    // Basis-Analyse ab Starter, vollständige ab Pro ([docs/07]).
    for (const p of PLANS) {
      if (allowsAnalysis(p, req.analysisTool)) return p;
    }
  }
  return req.minPlan ?? "free";
}

export type AccessResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly requiredPlan: Plan; readonly message: string };

const PRICING_URL = "https://gsc2mcp.drossmedia.de/pricing";

/**
 * Entscheidet, ob `plan` die `requires`-Angabe eines Tools erfüllt. Property- und
 * Grain-Voraussetzungen werden hier NICHT geprüft (die hängen an Sitzung und
 * Sync-Zustand) — nur die Plan-Berechtigung.
 */
export function checkAccess(plan: Plan, req: Requirement): AccessResult {
  const needed = requiredPlan(req);

  const analysisOk = req.analysisTool ? allowsAnalysis(plan, req.analysisTool) : true;
  const planOk = req.minPlan ? planRank(plan) >= planRank(req.minPlan) : true;

  if (analysisOk && planOk) return { ok: true };

  return {
    ok: false,
    requiredPlan: needed,
    message: `[${planLabel(plan)}] Dieses Werkzeug ist ab ${planLabel(needed)} verfügbar. → ${PRICING_URL}`,
  };
}

function planLabel(plan: Plan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
