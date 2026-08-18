/**
 * MCP-Endpunkt `/mcp` — Streamable HTTP ([docs/01], [docs/02]). Diese Schicht bindet
 * die Protokoll-Logik (`McpServer`) an den Sitzungsspeicher und einen injizierten
 * Authentifikator (der spätere OAuth-Resource-Server). Der JSON-Antwortpfad ist hier
 * vollständig und ohne Netzwerk testbar.
 *
 * Bewusst noch NICHT hier (netzgebunden, folgt mit dem laufenden Server):
 * - der eigentliche HTTP-Server (node:http bzw. der offizielle SDK-Transport),
 * - der langlebige SSE-Strom mit **Keepalive alle 30 s** (`: ping\n\n`), ohne den
 *   Cloudflares Idle-Timeout (900 s) ruhige Sitzungen abräumt ([docs/01]),
 * - langlaufende Tool-Aufträge, die wegen des 125-s-Read-Timeouts sofort annehmen und
 *   den Fortschritt nachreichen, statt synchron durchzulaufen.
 *
 * Cloudflare-Regeln, die der Proxy davor durchsetzt: kein Caching, `no-transform`,
 * SSE ungepuffert. Antworten hier tragen `Cache-Control: no-store` als Ergänzung.
 */

import type { Session } from "../router.ts";
import type { McpServer } from "./dispatch.ts";
import type { SessionStore } from "./session.ts";
import { asRequest, failure, RPC_ERROR, type JsonRpcResponse } from "./jsonrpc.ts";
import { withRequestContext } from "../runtime/context.ts";

/** Führt eine Nachricht mit gesetztem Request-Kontext aus (für die per-Nutzer-Token-Auflösung). */
function receiveInContext(
  server: McpServer,
  rpc: Parameters<McpServer["receive"]>[0],
  session: Session,
): Promise<JsonRpcResponse | null> {
  return withRequestContext(
    { userId: session.userId, plan: session.plan, ...(session.propertyId === undefined ? {} : { propertyId: session.propertyId }) },
    () => server.receive(rpc, session),
  );
}

const SESSION_HEADER = "mcp-session-id";

/** Ermittelt die Identität (Plan, Nutzer) aus den Anfrage-Headern — der OAuth-Layer. */
export type Authenticator = (headers: Readonly<Record<string, string>>) => Promise<Session | null>;

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface McpEndpointDeps {
  readonly server: McpServer;
  readonly store: SessionStore;
  readonly authenticate: Authenticator;
}

export class McpEndpoint {
  readonly #server: McpServer;
  readonly #store: SessionStore;
  readonly #authenticate: Authenticator;

  constructor(deps: McpEndpointDeps) {
    this.#server = deps.server;
    this.#store = deps.store;
    this.#authenticate = deps.authenticate;
  }

  /** POST /mcp — eine JSON-RPC-Nachricht (Batches sind ab MCP 2025-06-18 unzulässig). */
  async post(rawBody: string, headers: Readonly<Record<string, string>> = {}): Promise<HttpResponse> {
    const h = lower(headers);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return json(400, failure(null, RPC_ERROR.ParseError, "Ungültiges JSON."));
    }
    if (Array.isArray(parsed)) {
      return json(400, failure(null, RPC_ERROR.InvalidRequest, "Batches sind nicht unterstützt (MCP 2025-06-18)."));
    }
    const rpc = asRequest(parsed);
    if (!rpc) {
      return json(400, failure(null, RPC_ERROR.InvalidRequest, "Keine gültige JSON-RPC-2.0-Nachricht."));
    }
    const id = rpc.id ?? null;

    // initialize begründet die Sitzung; die Session-Id wird im Response-Header gesetzt.
    if (rpc.method === "initialize") {
      const session = await this.#authenticate(h);
      if (!session) return json(401, failure(id, RPC_ERROR.InvalidRequest, "Nicht authentifiziert."));
      const mcp = await this.#store.create(session);
      const response = await receiveInContext(this.#server, rpc, session);
      return json(200, response, mcp.id);
    }

    const sessionId = h[SESSION_HEADER];
    if (!sessionId) {
      return json(400, failure(id, RPC_ERROR.InvalidRequest, "Mcp-Session-Id fehlt."));
    }
    const mcp = await this.#store.get(sessionId);
    if (!mcp) {
      return json(404, failure(id, RPC_ERROR.InvalidRequest, "Unbekannte Sitzung."));
    }
    if (rpc.method === "notifications/initialized") {
      await this.#store.markInitialized(sessionId);
    }

    const response = await receiveInContext(this.#server, rpc, mcp.session);
    // Notification: keine Antwort, aber angenommen.
    if (response === null) return { status: 202, headers: NO_STORE, body: "" };
    return json(200, response);
  }

  /** DELETE /mcp — beendet die Sitzung ([docs/01]). */
  async delete(headers: Readonly<Record<string, string>> = {}): Promise<HttpResponse> {
    const sessionId = lower(headers)[SESSION_HEADER];
    if (!sessionId) return { status: 400, headers: NO_STORE, body: "" };
    await this.#store.delete(sessionId);
    return { status: 204, headers: NO_STORE, body: "" };
  }
}

const NO_STORE: Record<string, string> = { "cache-control": "no-store" };

function lower(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

function json(status: number, body: JsonRpcResponse | null, sessionId?: string): HttpResponse {
  return {
    status,
    headers: {
      "content-type": "application/json",
      ...NO_STORE,
      ...(sessionId ? { [SESSION_HEADER]: sessionId } : {}),
    },
    body: body === null ? "" : JSON.stringify(body),
  };
}
