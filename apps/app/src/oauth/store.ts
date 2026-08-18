/**
 * OAuth-Speicher ([docs/02]). Schnittstellen für Clients (Dynamic Client Registration)
 * und ausgegebene Access-Tokens, plus prozesslokale In-Memory-Varianten für Tests. Die
 * echten Implementierungen liegen später hinter `packages/db` (Tabellen der Control
 * Plane); die Schnittstelle bleibt dieselbe.
 */

export interface OAuthClient {
  readonly clientId: string;
  /** Nur vertrauliche Clients; öffentliche (PKCE) haben keins. */
  readonly clientSecret?: string;
  readonly redirectUris: readonly string[];
  readonly tokenEndpointAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  readonly grantTypes: readonly string[];
  readonly responseTypes: readonly string[];
  readonly scope?: string;
  readonly clientName?: string;
  readonly createdAt: number; // epoch ms
}

/** Was ein ausgegebenes Access-Token repräsentiert. */
export interface AccessGrant {
  readonly token: string;
  readonly userId: number;
  readonly scope: string;
  /** Zielressource (RFC 8707) — bindet das Token an genau diesen Server. */
  readonly audience?: string;
  readonly expiresAt: number; // epoch ms
}

export interface ClientStore {
  save(client: OAuthClient): Promise<void>;
  get(clientId: string): Promise<OAuthClient | undefined>;
}

export interface TokenStore {
  saveAccess(grant: AccessGrant): Promise<void>;
  getAccess(token: string): Promise<AccessGrant | undefined>;
  revokeAccess(token: string): Promise<void>;
}

export class InMemoryClientStore implements ClientStore {
  readonly #clients = new Map<string, OAuthClient>();

  async save(client: OAuthClient): Promise<void> {
    this.#clients.set(client.clientId, client);
  }

  async get(clientId: string): Promise<OAuthClient | undefined> {
    return this.#clients.get(clientId);
  }
}

export class InMemoryTokenStore implements TokenStore {
  readonly #tokens = new Map<string, AccessGrant>();

  async saveAccess(grant: AccessGrant): Promise<void> {
    this.#tokens.set(grant.token, grant);
  }

  async getAccess(token: string): Promise<AccessGrant | undefined> {
    return this.#tokens.get(token);
  }

  async revokeAccess(token: string): Promise<void> {
    this.#tokens.delete(token);
  }
}
