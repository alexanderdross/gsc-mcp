/**
 * JSON-RPC 2.0 — Umschlag und Fehlercodes für den MCP-Transport ([docs/01]).
 * Rein und ohne Netzwerk: Der HTTP-/SSE-Rahmen (Streamable HTTP) liegt darüber,
 * diese Typen beschreiben nur die Nachrichten.
 */

export const JSONRPC_VERSION = "2.0";

export type JsonRpcId = string | number | null;

/** Eine eingehende Nachricht. Fehlt `id`, ist es eine Notification (keine Antwort). */
export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Standard-Fehlercodes ([JSON-RPC 2.0]). */
export const RPC_ERROR = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

/** Notification = Nachricht ohne `id`; sie erhält nie eine Antwort. */
export function isNotification(msg: JsonRpcRequest): boolean {
  return msg.id === undefined;
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** Prüft die Grundstruktur und liefert eine getippte Anfrage oder `null`. */
export function asRequest(value: unknown): JsonRpcRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.jsonrpc !== JSONRPC_VERSION || typeof v.method !== "string") return null;
  if ("id" in v && !(typeof v.id === "string" || typeof v.id === "number" || v.id === null)) {
    return null;
  }
  return v as unknown as JsonRpcRequest;
}
