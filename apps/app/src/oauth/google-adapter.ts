/**
 * Konkreter `GoogleAuth`-Adapter ([docs/02] Ebene 2). Baut die Google-Consent-URL und
 * tauscht den Authorization-Code am Google-Token-Endpunkt gegen Identität und
 * Refresh-Token. `fetchFn` ist injizierbar — der Adapter ist damit ohne Netzwerk
 * testbar (dasselbe Muster wie der GSC-Client).
 *
 * Der Refresh-Token verlässt den Server nie im Klartext an den Client; er wird
 * verschlüsselt abgelegt ([crypto.ts]).
 */

import type { FetchFn } from "@gsc/gsc-client";
import type { GoogleAuth, GoogleIdentity } from "./google.ts";

const DEFAULT_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Unser Rückkanal, z. B. https://gsc2mcp.drossmedia.de/oauth/google/callback */
  readonly redirectUri: string;
  readonly authEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly fetchFn?: FetchFn;
}

interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly scope?: string;
  readonly expires_in?: number;
}

export class GoogleOAuth implements GoogleAuth {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;
  readonly #authEndpoint: string;
  readonly #tokenEndpoint: string;
  readonly #fetch: FetchFn;

  constructor(cfg: GoogleOAuthConfig) {
    this.#clientId = cfg.clientId;
    this.#clientSecret = cfg.clientSecret;
    this.#redirectUri = cfg.redirectUri;
    this.#authEndpoint = cfg.authEndpoint ?? DEFAULT_AUTH_ENDPOINT;
    this.#tokenEndpoint = cfg.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    this.#fetch = cfg.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  authorizeUrl(state: string, scopes: readonly string[]): string {
    const url = new URL(this.#authEndpoint);
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", this.#redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    // offline + consent erzwingen einen Refresh-Token, auch bei erneuter Zustimmung.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return url.toString();
  }

  async exchange(code: string): Promise<GoogleIdentity> {
    const body = new URLSearchParams({
      code,
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      redirect_uri: this.#redirectUri,
      grant_type: "authorization_code",
    }).toString();

    const res = await this.#fetch(this.#tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Google-Token-Endpunkt antwortete mit ${res.status}.`);
    }
    const json = (await res.json()) as GoogleTokenResponse;
    if (!json.id_token) {
      throw new Error("Google-Antwort ohne id_token (openid-Scope fehlt?).");
    }
    const claims = decodeIdToken(json.id_token);
    if (!claims.sub || !claims.email) {
      throw new Error("id_token ohne sub/email.");
    }
    return {
      googleSub: claims.sub,
      email: claims.email,
      ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
      scopes: (json.scope ?? "").split(" ").filter(Boolean),
    };
  }

  /** Tauscht einen Refresh-Token gegen einen frischen Access-Token (grant_type=refresh_token). */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      grant_type: "refresh_token",
    }).toString();

    const res = await this.#fetch(this.#tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Google-Token-Endpunkt (refresh) antwortete mit ${res.status}.`);
    }
    const json = (await res.json()) as GoogleTokenResponse;
    if (!json.access_token) {
      throw new Error("Google-Refresh-Antwort ohne access_token.");
    }
    return { accessToken: json.access_token, expiresInSec: json.expires_in ?? 3600 };
  }
}

/** Was der Token-Provider von einem Google-Adapter braucht (für Tests injizierbar). */
export interface GoogleTokenRefresher {
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }>;
}

/**
 * Liest `sub` und `email` aus dem id_token. Da das Token direkt vom Google-Token-
 * Endpunkt über TLS stammt, genügt das Dekodieren der Payload; käme es je über einen
 * nicht vertrauenswürdigen Kanal, wäre die Signatur gegen Googles JWKS zu prüfen.
 */
export function decodeIdToken(idToken: string): { sub?: string; email?: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("id_token ist kein JWT.");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  return {
    ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}),
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
  };
}
