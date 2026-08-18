/**
 * Dynamic Client Registration (RFC 7591) ([docs/02]). Claude registriert sich selbst
 * am `/register`-Endpunkt; wir vergeben eine `client_id`. Öffentliche Clients (PKCE)
 * bekommen kein Secret. Redirect-URIs werden validiert, nicht fest verdrahtet — sie
 * kommen aus der Registrierung und werden später beim `/authorize` exakt geprüft.
 */

import type { ClientStore, OAuthClient } from "./store.ts";

export interface RegistrationRequest {
  readonly redirect_uris?: readonly string[];
  readonly token_endpoint_auth_method?: string;
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly client_name?: string;
  readonly scope?: string;
}

export interface RegistrationDeps {
  readonly store: ClientStore;
  readonly newClientId: () => string;
  readonly newClientSecret: () => string;
  readonly now: () => number;
}

export interface RegistrationOutcome {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const AUTH_METHODS = new Set(["none", "client_secret_basic", "client_secret_post"]);

/** Prüft eine Redirect-URI: absolute https, oder http nur auf Loopback (Native-Clients). */
export function isValidRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== "") return false; // Fragmente sind unzulässig
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  return false;
}

function error(status: number, code: string, description: string): RegistrationOutcome {
  return { status, body: { error: code, error_description: description } };
}

/** Verarbeitet eine Registrierungsanfrage und legt den Client an. */
export async function registerClient(
  req: RegistrationRequest,
  deps: RegistrationDeps,
): Promise<RegistrationOutcome> {
  const redirectUris = req.redirect_uris ?? [];
  if (redirectUris.length === 0) {
    return error(400, "invalid_redirect_uri", "redirect_uris ist erforderlich.");
  }
  for (const uri of redirectUris) {
    if (!isValidRedirectUri(uri)) {
      return error(400, "invalid_redirect_uri", `Unzulässige redirect_uri: ${uri}`);
    }
  }

  const authMethod = req.token_endpoint_auth_method ?? "none";
  if (!AUTH_METHODS.has(authMethod)) {
    return error(400, "invalid_client_metadata", `Unbekannte token_endpoint_auth_method: ${authMethod}`);
  }

  const grantTypes = req.grant_types ?? ["authorization_code", "refresh_token"];
  const responseTypes = req.response_types ?? ["code"];
  const confidential = authMethod !== "none";

  const client: OAuthClient = {
    clientId: deps.newClientId(),
    ...(confidential ? { clientSecret: deps.newClientSecret() } : {}),
    redirectUris: [...redirectUris],
    tokenEndpointAuthMethod: authMethod as OAuthClient["tokenEndpointAuthMethod"],
    grantTypes: [...grantTypes],
    responseTypes: [...responseTypes],
    ...(req.scope === undefined ? {} : { scope: req.scope }),
    ...(req.client_name === undefined ? {} : { clientName: req.client_name }),
    createdAt: deps.now(),
  };
  await deps.store.save(client);

  return {
    status: 201,
    body: {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      ...(client.scope ? { scope: client.scope } : {}),
      ...(client.clientName ? { client_name: client.clientName } : {}),
    },
  };
}
