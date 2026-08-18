/**
 * Tool-Definitionsrahmen ([docs/05], [docs/10]). Ein Tool ist im Wesentlichen eine
 * Deklaration: Schema, Annotationen, Voraussetzungen, Handler. Der Router liest die
 * `requires`-Angabe zentral aus — kein Handler prüft seine eigene Berechtigung, damit
 * keiner sie vergisst.
 */

import type { z } from "zod";
import type { AnalysisTool, Plan } from "@gsc/core";

/** Was ein Tool voraussetzt, bevor der Handler überhaupt läuft. */
export interface Requirement {
  /** Mindestplan (Rangvergleich). Ohne Angabe: ab free. */
  readonly minPlan?: Plan;
  /** Falls es ein plangeschaltetes Analyse-Tool ist: dessen Name. */
  readonly analysisTool?: AnalysisTool;
  /** Setzt eine gewählte Property in der Sitzung voraus. */
  readonly needsProperty?: boolean;
  /** Setzt einen synchronisierten Grain voraus (sonst Live-Fallback/Hinweis). */
  readonly grains?: readonly string[];
}

/** MCP-Tool-Annotationen. Pflicht für die Directory-Listung ([docs/11]). */
export interface Annotations {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint?: boolean;
}

export type Detail = "summary" | "standard" | "full";

/** Kontext, den der Router jedem Handler mitgibt. */
export interface ToolContext {
  readonly plan: Plan;
  readonly userId: number;
  readonly propertyId?: number;
  readonly detail: Detail;
}

export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  readonly name: string;
  readonly annotations: Annotations;
  readonly input: I;
  readonly requires: Requirement;
  readonly handler: (ctx: ToolContext, input: z.infer<I>) => Promise<O>;
}

/** Identität mit Typprüfung — hält Definition und Handler-Signatur konsistent. */
export function defineTool<I extends z.ZodTypeAny, O>(
  def: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return def;
}

/**
 * Typ-gelöschte Sicht für Registry und Router: Ein konkretes Tool mit spezifischem
 * Schema ist hierzu zuweisbar (der Handler-Parameter ist bewusst `any`), während der
 * `defineTool`-Aufruf die enge Typprüfung behält.
 */
export interface AnyTool {
  readonly name: string;
  readonly annotations: Annotations;
  readonly input: z.ZodTypeAny;
  readonly requires: Requirement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: (ctx: ToolContext, input: any) => Promise<unknown>;
}
