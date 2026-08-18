/**
 * Persistente OAuth-Speicher gegen PostgreSQL ([docs/02], [docs/03]). Erfüllen die
 * In-Memory-Schnittstellen (`store.ts`, `codes.ts`) mit Drizzle-Abfragen; Einlösung von
 * Code und Pending läuft als `DELETE … RETURNING` (atomarer Einmalgebrauch). Die
 * Tokens tragen nur `user_id`, Scope und Zielressource — nie Google-Credentials.
 */

import { eq } from "drizzle-orm";
import { schema, type Db } from "@gsc/db";
import type { PkceMethod } from "./pkce.ts";
import type { ClientStore, OAuthClient, TokenStore, AccessGrant, RefreshGrant } from "./store.ts";
import type { AuthCodeStore, AuthCode, PendingStore, PendingAuthorization } from "./codes.ts";

const { oauthClients, oauthPending, oauthAuthCodes, oauthAccessTokens, oauthRefreshTokens } = schema;

export class DbClientStore implements ClientStore {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  async save(client: OAuthClient): Promise<void> {
    await this.#db
      .insert(oauthClients)
      .values({
        clientId: client.clientId,
        clientSecret: client.clientSecret ?? null,
        redirectUris: [...client.redirectUris],
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        grantTypes: [...client.grantTypes],
        responseTypes: [...client.responseTypes],
        scope: client.scope ?? null,
        clientName: client.clientName ?? null,
        createdAt: new Date(client.createdAt),
      })
      .onConflictDoNothing();
  }

  async get(clientId: string): Promise<OAuthClient | undefined> {
    const [r] = await this.#db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
    if (!r) return undefined;
    return {
      clientId: r.clientId,
      ...(r.clientSecret != null ? { clientSecret: r.clientSecret } : {}),
      redirectUris: r.redirectUris,
      tokenEndpointAuthMethod: r.tokenEndpointAuthMethod as OAuthClient["tokenEndpointAuthMethod"],
      grantTypes: r.grantTypes,
      responseTypes: r.responseTypes,
      ...(r.scope != null ? { scope: r.scope } : {}),
      ...(r.clientName != null ? { clientName: r.clientName } : {}),
      createdAt: r.createdAt.getTime(),
    };
  }
}

export class DbTokenStore implements TokenStore {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  async saveAccess(grant: AccessGrant): Promise<void> {
    await this.#db
      .insert(oauthAccessTokens)
      .values({
        token: grant.token,
        userId: grant.userId,
        scope: grant.scope,
        audience: grant.audience ?? null,
        expiresAt: new Date(grant.expiresAt),
      })
      .onConflictDoNothing();
  }

  async getAccess(token: string): Promise<AccessGrant | undefined> {
    const [r] = await this.#db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.token, token)).limit(1);
    if (!r) return undefined;
    return {
      token: r.token,
      userId: r.userId,
      scope: r.scope,
      ...(r.audience != null ? { audience: r.audience } : {}),
      expiresAt: r.expiresAt.getTime(),
    };
  }

  async revokeAccess(token: string): Promise<void> {
    await this.#db.delete(oauthAccessTokens).where(eq(oauthAccessTokens.token, token));
  }

  async saveRefresh(grant: RefreshGrant): Promise<void> {
    await this.#db
      .insert(oauthRefreshTokens)
      .values({
        token: grant.token,
        userId: grant.userId,
        clientId: grant.clientId,
        scope: grant.scope,
        audience: grant.audience ?? null,
      })
      .onConflictDoNothing();
  }

  async getRefresh(token: string): Promise<RefreshGrant | undefined> {
    const [r] = await this.#db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.token, token)).limit(1);
    if (!r) return undefined;
    return {
      token: r.token,
      userId: r.userId,
      clientId: r.clientId,
      scope: r.scope,
      ...(r.audience != null ? { audience: r.audience } : {}),
    };
  }

  async revokeRefresh(token: string): Promise<void> {
    await this.#db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.token, token));
  }
}

export class DbAuthCodeStore implements AuthCodeStore {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  async save(code: AuthCode): Promise<void> {
    await this.#db
      .insert(oauthAuthCodes)
      .values({
        code: code.code,
        clientId: code.clientId,
        redirectUri: code.redirectUri,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        scope: code.scope,
        audience: code.audience ?? null,
        userId: code.userId,
        expiresAt: new Date(code.expiresAt),
      })
      .onConflictDoNothing();
  }

  async take(code: string): Promise<AuthCode | undefined> {
    // Atomarer Einmalgebrauch: lesen und löschen in einer Anweisung.
    const [r] = await this.#db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.code, code)).returning();
    if (!r) return undefined;
    return {
      code: r.code,
      clientId: r.clientId,
      redirectUri: r.redirectUri,
      codeChallenge: r.codeChallenge,
      codeChallengeMethod: r.codeChallengeMethod as PkceMethod,
      scope: r.scope,
      ...(r.audience != null ? { audience: r.audience } : {}),
      userId: r.userId,
      expiresAt: r.expiresAt.getTime(),
    };
  }
}

export class DbPendingStore implements PendingStore {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  async save(pending: PendingAuthorization): Promise<void> {
    await this.#db
      .insert(oauthPending)
      .values({
        state: pending.state,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: pending.codeChallengeMethod,
        scope: pending.scope,
        audience: pending.audience ?? null,
        clientState: pending.clientState ?? null,
      })
      .onConflictDoNothing();
  }

  async take(state: string): Promise<PendingAuthorization | undefined> {
    const [r] = await this.#db.delete(oauthPending).where(eq(oauthPending.state, state)).returning();
    if (!r) return undefined;
    return {
      state: r.state,
      clientId: r.clientId,
      redirectUri: r.redirectUri,
      codeChallenge: r.codeChallenge,
      codeChallengeMethod: r.codeChallengeMethod as PkceMethod,
      scope: r.scope,
      ...(r.audience != null ? { audience: r.audience } : {}),
      ...(r.clientState != null ? { clientState: r.clientState } : {}),
    };
  }
}
