/**
 * Kurzlebige Zustände des Autorisierungs-Flusses ([docs/02]): der einmalig einlösbare
 * Authorization-Code und die schwebende Autorisierung, die den Google-Umweg überbrückt.
 * Schnittstellen plus In-Memory-Varianten; die echten Speicher liegen später hinter
 * `packages/db`.
 */

import type { PkceMethod } from "./pkce.ts";

/** Ausgestellter Authorization-Code — an Client, Redirect, PKCE und Ressource gebunden. */
export interface AuthCode {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: PkceMethod;
  readonly scope: string;
  /** Zielressource (RFC 8707) → spätere Token-Audience. */
  readonly audience?: string;
  readonly userId: number;
  readonly expiresAt: number; // epoch ms
}

/**
 * Schwebende Autorisierung während der Google-Zustimmung. Wir schlüsseln nach *unserem*
 * `state`; der `clientState` wird unverändert an den Client zurückgereicht.
 */
export interface PendingAuthorization {
  readonly state: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: PkceMethod;
  readonly scope: string;
  readonly audience?: string;
  readonly clientState?: string;
}

export interface AuthCodeStore {
  save(code: AuthCode): Promise<void>;
  /** Liest und entfernt den Code — Einmalgebrauch. */
  take(code: string): Promise<AuthCode | undefined>;
}

export interface PendingStore {
  save(pending: PendingAuthorization): Promise<void>;
  take(state: string): Promise<PendingAuthorization | undefined>;
}

export class InMemoryAuthCodeStore implements AuthCodeStore {
  readonly #codes = new Map<string, AuthCode>();

  async save(code: AuthCode): Promise<void> {
    this.#codes.set(code.code, code);
  }

  async take(code: string): Promise<AuthCode | undefined> {
    const found = this.#codes.get(code);
    if (found) this.#codes.delete(code);
    return found;
  }
}

export class InMemoryPendingStore implements PendingStore {
  readonly #pending = new Map<string, PendingAuthorization>();

  async save(pending: PendingAuthorization): Promise<void> {
    this.#pending.set(pending.state, pending);
  }

  async take(state: string): Promise<PendingAuthorization | undefined> {
    const found = this.#pending.get(state);
    if (found) this.#pending.delete(state);
    return found;
  }
}
