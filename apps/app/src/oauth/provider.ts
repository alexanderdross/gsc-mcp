/**
 * Autorisierungs-Fluss des eigenen AS ([docs/02]): `/authorize` → Google-Zustimmung →
 * Rückkanal → Authorization-Code → `/token`. Reine, testbare Logik über injizierte
 * Speicher, einen `GoogleAuth`-Adapter, ein `UserDirectory` und Generatoren; das
 * Ausliefern über HTTP und die echten Google-Aufrufe folgen mit der Verdrahtung.
 *
 * OAuth 2.1: nur `response_type=code`, PKCE-S256 Pflicht, Resource Indicators (RFC 8707)
 * binden das Token an genau diese Ressource. Codes sind einmalig und kurzlebig.
 */

import { randomBytes } from "node:crypto";
import { verifyPkce, type PkceMethod } from "./pkce.ts";
import type { ClientStore, TokenStore } from "./store.ts";
import type { AuthCodeStore, PendingStore } from "./codes.ts";
import type { GoogleAuth, UserDirectory } from "./google.ts";

export interface OAuthGenerators {
  authCode(): string;
  accessToken(): string;
  refreshToken(): string;
  state(): string;
}

/** Zufällige, URL-sichere Tokens für die Produktivgeneratoren. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function defaultGenerators(): OAuthGenerators {
  return {
    authCode: () => randomToken(),
    accessToken: () => randomToken(),
    refreshToken: () => randomToken(),
    state: () => randomToken(16),
  };
}

export interface OAuthProviderDeps {
  readonly clients: ClientStore;
  readonly codes: AuthCodeStore;
  readonly tokens: TokenStore;
  readonly pending: PendingStore;
  readonly users: UserDirectory;
  readonly google: GoogleAuth;
  readonly gen: OAuthGenerators;
  /** Google-Scopes für die Zustimmung, z. B. openid email webmasters.readonly. */
  readonly googleScopes: readonly string[];
  readonly now?: () => number;
  readonly accessTtlMs?: number; // Vorgabe 1 h
  readonly codeTtlMs?: number; // Vorgabe 10 min
}

export interface AuthorizeParams {
  readonly response_type?: string;
  readonly client_id?: string;
  readonly redirect_uri?: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  readonly scope?: string;
  readonly state?: string;
  readonly resource?: string;
}

export type AuthorizeResult =
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "error_redirect"; readonly location: string }
  | { readonly kind: "error"; readonly status: number; readonly body: Record<string, unknown> };

export type CallbackResult =
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "error"; readonly status: number; readonly body: Record<string, unknown> };

export interface TokenParams {
  readonly grant_type?: string;
  readonly code?: string;
  readonly redirect_uri?: string;
  readonly client_id?: string;
  readonly client_secret?: string;
  readonly code_verifier?: string;
  readonly refresh_token?: string;
}

export interface TokenResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export class OAuthProvider {
  readonly #d: OAuthProviderDeps;
  readonly #now: () => number;
  readonly #accessTtl: number;
  readonly #codeTtl: number;

  constructor(deps: OAuthProviderDeps) {
    this.#d = deps;
    this.#now = deps.now ?? (() => Date.now());
    this.#accessTtl = deps.accessTtlMs ?? 3_600_000;
    this.#codeTtl = deps.codeTtlMs ?? 600_000;
  }

  /** `/authorize` — validiert und leitet zur Google-Zustimmung weiter. */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.client_id) return badRequest("invalid_request", "client_id fehlt.");
    const client = await this.#d.clients.get(params.client_id);
    if (!client) return badRequest("invalid_client", "Unbekannter client_id.");

    const redirectUri = params.redirect_uri;
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      // Ungültige Redirect-URI niemals ansteuern — hier hart 400.
      return badRequest("invalid_request", "redirect_uri unbekannt oder nicht registriert.");
    }

    // Ab hier sind Fehler dem Client als Redirect zuzustellen.
    const back = (error: string, desc: string): AuthorizeResult => ({
      kind: "error_redirect",
      location: withParams(redirectUri, { error, error_description: desc, state: params.state }),
    });
    if (params.response_type !== "code") return back("unsupported_response_type", "Nur response_type=code.");
    if (!params.code_challenge) return back("invalid_request", "code_challenge fehlt (PKCE Pflicht).");
    if ((params.code_challenge_method ?? "S256") !== "S256") {
      return back("invalid_request", "Nur code_challenge_method=S256.");
    }

    const scope = params.scope ?? client.scope ?? "mcp";
    const state = this.#d.gen.state();
    await this.#d.pending.save({
      state,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: "S256",
      scope,
      ...(params.resource === undefined ? {} : { audience: params.resource }),
      ...(params.state === undefined ? {} : { clientState: params.state }),
    });
    return { kind: "redirect", location: this.#d.google.authorizeUrl(state, this.#d.googleScopes) };
  }

  /** Rückkanal der Google-Zustimmung — mündet in unseren Authorization-Code. */
  async googleCallback(params: { code?: string; state?: string; error?: string }): Promise<CallbackResult> {
    if (!params.state) return badRequest("invalid_request", "state fehlt.");
    const pending = await this.#d.pending.take(params.state);
    if (!pending) return badRequest("invalid_request", "Unbekannter oder abgelaufener state.");

    if (params.error) {
      return {
        kind: "redirect",
        location: withParams(pending.redirectUri, {
          error: "access_denied",
          error_description: params.error,
          state: pending.clientState,
        }),
      };
    }
    if (!params.code) return badRequest("invalid_request", "code fehlt.");

    let userId: number;
    try {
      const identity = await this.#d.google.exchange(params.code);
      ({ userId } = await this.#d.users.linkGoogle(identity));
    } catch {
      return {
        kind: "redirect",
        location: withParams(pending.redirectUri, {
          error: "server_error",
          error_description: "Google-Verknüpfung fehlgeschlagen.",
          state: pending.clientState,
        }),
      };
    }

    const code = this.#d.gen.authCode();
    await this.#d.codes.save({
      code,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod as PkceMethod,
      scope: pending.scope,
      ...(pending.audience === undefined ? {} : { audience: pending.audience }),
      userId,
      expiresAt: this.#now() + this.#codeTtl,
    });
    return {
      kind: "redirect",
      location: withParams(pending.redirectUri, { code, state: pending.clientState }),
    };
  }

  /** `/token` — Authorization-Code- und Refresh-Token-Grant. */
  async token(params: TokenParams): Promise<TokenResult> {
    if (params.grant_type === "authorization_code") return this.#authCodeGrant(params);
    if (params.grant_type === "refresh_token") return this.#refreshGrant(params);
    return tokenError(400, "unsupported_grant_type", "Nicht unterstützter grant_type.");
  }

  async #authCodeGrant(params: TokenParams): Promise<TokenResult> {
    if (!params.code) return tokenError(400, "invalid_request", "code fehlt.");
    // OAuth 2.1: öffentliche wie vertrauliche Clients identifizieren sich per client_id.
    if (!params.client_id) return tokenError(400, "invalid_request", "client_id fehlt.");
    // Client-Authentifizierung ZUERST — ein fehlendes Secret verbrennt den Code nicht.
    const clientErr = await this.#authenticateClient(params.client_id, params);
    if (clientErr) return clientErr;

    const ac = await this.#d.codes.take(params.code); // Einmalgebrauch
    if (!ac) return tokenError(400, "invalid_grant", "Unbekannter oder bereits eingelöster code.");
    if (ac.expiresAt <= this.#now()) return tokenError(400, "invalid_grant", "code abgelaufen.");
    if (params.client_id !== ac.clientId) return tokenError(400, "invalid_grant", "client_id passt nicht zum code.");
    if (params.redirect_uri !== ac.redirectUri) {
      return tokenError(400, "invalid_grant", "redirect_uri passt nicht zum code.");
    }
    if (!params.code_verifier) return tokenError(400, "invalid_request", "code_verifier fehlt (PKCE).");
    if (!verifyPkce(params.code_verifier, ac.codeChallenge, ac.codeChallengeMethod)) {
      return tokenError(400, "invalid_grant", "PKCE-Prüfung fehlgeschlagen.");
    }
    return this.#issue(ac.userId, ac.clientId, ac.scope, ac.audience);
  }

  async #refreshGrant(params: TokenParams): Promise<TokenResult> {
    if (!params.refresh_token) return tokenError(400, "invalid_request", "refresh_token fehlt.");
    const rr = await this.#d.tokens.getRefresh(params.refresh_token);
    if (!rr) return tokenError(400, "invalid_grant", "Unbekannter refresh_token.");
    if (params.client_id !== undefined && params.client_id !== rr.clientId) {
      return tokenError(400, "invalid_grant", "client_id passt nicht zum refresh_token.");
    }
    const clientErr = await this.#authenticateClient(rr.clientId, params);
    if (clientErr) return clientErr;
    // Rotation: alten Refresh entwerten, neues Paar ausgeben.
    await this.#d.tokens.revokeRefresh(rr.token);
    return this.#issue(rr.userId, rr.clientId, rr.scope, rr.audience);
  }

  /** Gibt bei vertraulichen Clients einen Fehler zurück, sonst `undefined`. */
  async #authenticateClient(clientId: string, params: TokenParams): Promise<TokenResult | undefined> {
    const client = await this.#d.clients.get(clientId);
    if (!client) return tokenError(401, "invalid_client", "Unbekannter Client.");
    if (client.tokenEndpointAuthMethod !== "none") {
      if (!params.client_secret || params.client_secret !== client.clientSecret) {
        return tokenError(401, "invalid_client", "Client-Authentifizierung fehlgeschlagen.");
      }
    }
    return undefined;
  }

  async #issue(userId: number, clientId: string, scope: string, audience: string | undefined): Promise<TokenResult> {
    const access = this.#d.gen.accessToken();
    const refresh = this.#d.gen.refreshToken();
    const expiresAt = this.#now() + this.#accessTtl;
    await this.#d.tokens.saveAccess({ token: access, userId, scope, ...(audience === undefined ? {} : { audience }), expiresAt });
    await this.#d.tokens.saveRefresh({ token: refresh, userId, clientId, scope, ...(audience === undefined ? {} : { audience }) });
    return {
      status: 200,
      body: {
        access_token: access,
        token_type: "Bearer",
        expires_in: Math.floor(this.#accessTtl / 1000),
        refresh_token: refresh,
        scope,
      },
    };
  }
}

/* ── Helfer ────────────────────────────────────────────────────────────────── */

function badRequest(error: string, description: string): { kind: "error"; status: number; body: Record<string, unknown> } {
  return { kind: "error", status: 400, body: { error, error_description: description } };
}

function tokenError(status: number, error: string, description: string): TokenResult {
  return { status, body: { error, error_description: description } };
}

/** Hängt Query-Parameter an eine (registrierte) Redirect-URI; `undefined` wird ausgelassen. */
function withParams(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
