/**
 * Tool-Router. Der einzige Weg, ein Tool auszuführen: validiert die Eingabe,
 * prüft zentral die Berechtigung ([access.ts]) und die Mandantenzugehörigkeit,
 * ruft dann den Handler. Kein Handler prüft seine eigene Berechtigung.
 */

import type { Plan } from "@gsc/core";
import { checkAccess } from "./access.ts";
import type { ToolRegistry } from "./registry.ts";
import type { Detail, ToolContext } from "./tool.ts";

export interface Session {
  readonly plan: Plan;
  readonly userId: number;
  readonly propertyId?: number;
  readonly detail?: Detail;
}

/** Prüft, ob eine Property dem Nutzer gehört — injizierbar, damit Tests ohne DB laufen. */
export type OwnershipCheck = (userId: number, propertyId: number) => Promise<boolean>;

export type RouteResult =
  | { readonly kind: "ok"; readonly output: unknown }
  | { readonly kind: "denied"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface RouterOptions {
  readonly ownershipCheck?: OwnershipCheck;
}

export class Router {
  readonly #registry: ToolRegistry;
  readonly #ownershipCheck: OwnershipCheck;

  constructor(registry: ToolRegistry, opts: RouterOptions = {}) {
    this.#registry = registry;
    // Ohne echte Prüfung wird Zugriff verweigert statt fälschlich gewährt.
    this.#ownershipCheck = opts.ownershipCheck ?? (async () => false);
  }

  async run(session: Session, toolName: string, rawInput: unknown): Promise<RouteResult> {
    const tool = this.#registry.get(toolName);
    if (!tool) return { kind: "error", message: `Unbekanntes Tool: ${toolName}` };

    // 1. Berechtigung nach Plan.
    const access = checkAccess(session.plan, tool.requires);
    if (!access.ok) return { kind: "denied", message: access.message };

    // 2. Eingabe validieren.
    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      return { kind: "error", message: `Ungültige Eingabe: ${parsed.error.message}` };
    }

    // 3. Property-Voraussetzung und Mandantentrennung — zentral, nicht im Handler.
    if (tool.requires.needsProperty) {
      if (session.propertyId === undefined) {
        return { kind: "denied", message: "Bitte zuerst eine Property auswählen (select_property)." };
      }
      const owns = await this.#ownershipCheck(session.userId, session.propertyId);
      if (!owns) {
        return { kind: "error", message: "Kein Zugriff auf diese Property." };
      }
    }

    // 4. Handler ausführen.
    const ctx: ToolContext = {
      plan: session.plan,
      userId: session.userId,
      detail: session.detail ?? "standard",
      ...(session.propertyId === undefined ? {} : { propertyId: session.propertyId }),
    };
    try {
      const output = await tool.handler(ctx, parsed.data);
      return { kind: "ok", output };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Interner Fehler im Tool.",
      };
    }
  }
}
