/**
 * MCP-Methodenrouting ([docs/05], [docs/01]) — die Protokoll-Logik hinter dem
 * Transport. Bildet `initialize`, `tools/list` und `tools/call` auf die Registry und
 * den Router ab. Rein und ohne Netzwerk: Der HTTP-/SSE-Rahmen (Streamable HTTP) reicht
 * eine bereits authentifizierte `Session` herein und serialisiert die Antwort.
 *
 * Der produktive Transport kann den `StreamableHTTPServerTransport` des offiziellen
 * SDK davorsetzen ([docs/01]); dieselben Bausteine — Tool-Deskriptoren, das
 * Ergebnis-Mapping und der Router — werden dort unverändert genutzt.
 */

import type { AnyTool } from "../tool.ts";
import type { ToolRegistry } from "../registry.ts";
import type { Router, Session, RouteResult } from "../router.ts";
import { jsonSchemaFromZod, type JsonSchema } from "./schema.ts";
import {
  isNotification,
  success,
  failure,
  RPC_ERROR,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./jsonrpc.ts";

/** Aktueller Streamable-HTTP-Protokollstand. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "gsc-mcp", version: "0.1.0" } as const;
const INSTRUCTIONS =
  "Google-Search-Console-Daten auf Basis des vollständigen Bulk-Exports. " +
  "Zuerst eine Property wählen; datentragende Tools verlangen sie. Antworten sind " +
  "gedeckelt — bei Bedarf Filter verfeinern.";

/** MCP-Tool-Deskriptor, wie ihn `tools/list` liefert. */
export interface ToolDescriptor {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations: {
    readonly title: string;
    readonly readOnlyHint: boolean;
    readonly destructiveHint?: boolean;
  };
}

export function toolDescriptor(t: AnyTool): ToolDescriptor {
  return {
    name: t.name,
    title: t.annotations.title,
    description: t.annotations.title,
    inputSchema: jsonSchemaFromZod(t.input),
    annotations: {
      title: t.annotations.title,
      readOnlyHint: t.annotations.readOnlyHint,
      ...(t.annotations.destructiveHint === undefined
        ? {}
        : { destructiveHint: t.annotations.destructiveHint }),
    },
  };
}

/** Ein MCP-`CallToolResult`. Fachliche Fehler stehen als `isError`-Inhalt, nicht als Protokollfehler. */
export interface CallToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly isError?: boolean;
}

/**
 * Router-Ergebnis → CallToolResult. Verweigerung und Tool-Fehler werden als
 * `isError`-Inhalt zurückgegeben, damit der Agent die Meldung (z. B. den Upgrade-Hinweis)
 * wörtlich sieht — ein Protokollfehler wäre für ihn stumm.
 */
export function callToolResult(r: RouteResult): CallToolResult {
  if (r.kind === "ok") {
    return { content: [{ type: "text", text: JSON.stringify(r.output) }] };
  }
  return { content: [{ type: "text", text: r.message }], isError: true };
}

export class McpServer {
  readonly #registry: ToolRegistry;
  readonly #router: Router;

  constructor(registry: ToolRegistry, router: Router) {
    this.#registry = registry;
    this.#router = router;
  }

  /** Verarbeitet eine Nachricht. Notifications liefern `null` (keine Antwort). */
  async receive(rpc: JsonRpcRequest, session: Session): Promise<JsonRpcResponse | null> {
    const notification = isNotification(rpc);
    const id = rpc.id ?? null;
    try {
      switch (rpc.method) {
        case "initialize":
          return notification ? null : success(id, this.#initialize());

        case "notifications/initialized":
          return null;

        case "ping":
          return notification ? null : success(id, {});

        case "tools/list":
          return notification
            ? null
            : success(id, { tools: this.#registry.list().map(toolDescriptor) });

        case "tools/call": {
          if (notification) return null;
          const params = rpc.params as { name?: unknown; arguments?: unknown } | undefined;
          if (!params || typeof params.name !== "string") {
            return failure(id, RPC_ERROR.InvalidParams, "tools/call erfordert 'name'.");
          }
          const result = await this.#router.run(session, params.name, params.arguments ?? {});
          return success(id, callToolResult(result));
        }

        default:
          return notification
            ? null
            : failure(id, RPC_ERROR.MethodNotFound, `Unbekannte Methode: ${rpc.method}`);
      }
    } catch (err) {
      if (notification) return null;
      return failure(id, RPC_ERROR.InternalError, err instanceof Error ? err.message : "Interner Fehler");
    }
  }

  #initialize() {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    };
  }
}
