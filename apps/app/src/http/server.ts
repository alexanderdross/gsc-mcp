/**
 * Dünne `node:http`-Schale ([docs/01]). Liest Body und Query, flacht die Header ab und
 * ruft den reinen `HttpRouter`. Das ist der einzige netzgebundene Teil und bewusst
 * minimal — die gesamte Logik liegt im testbaren Router.
 *
 * Noch nicht hier (folgt mit dem SSE-Ausbau): der langlebige `text/event-stream`-Strom
 * für `/mcp` mit dem 30-s-Keepalive gegen Cloudflares Idle-Timeout. Dieser JSON-Pfad
 * bedient den Anfrage-Antwort-Verkehr; der Streaming-Pfad kommt daneben.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HttpRouter } from "./router.ts";

/** Erzeugt einen HTTP-Server, der jeden Request an den Router übergibt. */
export function createHttpServer(router: HttpRouter): Server {
  return createServer((req, res) => {
    void dispatch(router, req, res);
  });
}

async function dispatch(router: HttpRouter, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    const result = await router.handle({
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: flattenHeaders(req.headers),
      body,
    });
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch {
    res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: "internal_error" }));
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Header auf einfache Zeichenketten reduzieren (Mehrfachwerte kommagetrennt). */
function flattenHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
