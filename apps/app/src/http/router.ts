/**
 * HTTP-Routing des Servers ([docs/01], [docs/02]). Bindet die fertigen Bausteine —
 * MCP-Endpunkt, OAuth-Provider, DCR, Metadaten — an die Pfade hinter Cloudflare:
 * `/mcp`, `/authorize`, `/token`, `/register`, `/.well-known/*`, der Google-Rückkanal.
 *
 * Bewusst als reiner Handler `handle(HttpRequest) → HttpResponse` gehalten: vollständig
 * ohne Socket testbar. Die dünne `node:http`-Schale (`server.ts`) liest nur Body und
 * Query und ruft diesen Handler.
 */

import type { HttpResponse } from "../mcp/transport.ts";
import type { McpEndpoint } from "../mcp/transport.ts";
import type { OAuthProvider } from "../oauth/provider.ts";
import { registerClient, type RegistrationDeps } from "../oauth/dcr.ts";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpRouterDeps {
  readonly mcp: McpEndpoint;
  readonly provider: OAuthProvider;
  readonly registration: RegistrationDeps;
  readonly metadata: {
    readonly authorizationServer: Record<string, unknown>;
    readonly protectedResource: Record<string, unknown>;
  };
}

export class HttpRouter {
  readonly #d: HttpRouterDeps;

  constructor(deps: HttpRouterDeps) {
    this.#d = deps;
  }

  async handle(req: HttpRequest): Promise<HttpResponse> {
    const { method, path } = req;

    if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
      return json(200, this.#d.metadata.authorizationServer);
    }
    if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
      return json(200, this.#d.metadata.protectedResource);
    }

    if (method === "POST" && path === "/register") {
      let body: unknown;
      try {
        body = req.body ? JSON.parse(req.body) : {};
      } catch {
        return json(400, { error: "invalid_client_metadata", error_description: "Ungültiges JSON." });
      }
      const res = await registerClient(body as Record<string, unknown>, this.#d.registration);
      return json(res.status, res.body);
    }

    if (method === "GET" && path === "/authorize") {
      const res = await this.#d.provider.authorize(req.query);
      if (res.kind === "redirect" || res.kind === "error_redirect") return redirect(res.location);
      return json(res.status, res.body);
    }

    if (method === "GET" && path === "/oauth/google/callback") {
      const res = await this.#d.provider.googleCallback(req.query);
      if (res.kind === "redirect") return redirect(res.location);
      return json(res.status, res.body);
    }

    if (method === "POST" && path === "/token") {
      const params = Object.fromEntries(new URLSearchParams(req.body));
      const res = await this.#d.provider.token(params);
      return json(res.status, res.body);
    }

    if (path === "/mcp") {
      if (method === "POST") return this.#d.mcp.post(req.body, req.headers);
      if (method === "DELETE") return this.#d.mcp.delete(req.headers);
      return { status: 405, headers: NO_STORE, body: "" };
    }

    return json(404, { error: "not_found" });
  }
}

const NO_STORE: Record<string, string> = { "cache-control": "no-store" };

function json(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
    body: JSON.stringify(body),
  };
}

function redirect(location: string): HttpResponse {
  return { status: 302, headers: { location, ...NO_STORE }, body: "" };
}
