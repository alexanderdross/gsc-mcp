/**
 * Google-Access-Token je Nutzer ([docs/02], [docs/08]). Lädt den verschlüsselten
 * Refresh-Token aus `core.google_credentials`, entschlüsselt ihn, tauscht ihn gegen einen
 * kurzlebigen Access-Token und cached diesen bis kurz vor Ablauf. Der Klartext-Refresh-
 * Token verlässt den Server nie; der Access-Token bleibt im Prozess.
 *
 * Speist den `tokenProvider` des GSC-Clients für die Live-Inspektion — der Nutzer kommt
 * aus dem Request-Kontext ([runtime/context.ts]).
 */

import { eq, and, isNull } from "drizzle-orm";
import { schema, type Db } from "@gsc/db";
import type { GoogleTokenRefresher } from "./google-adapter.ts";
import { decryptSecret } from "./crypto.ts";

const { googleCredentials } = schema;

/** Liefert den verschlüsselten Refresh-Token eines Nutzers (oder null). */
export interface CredentialSource {
  getRefreshToken(userId: number): Promise<Buffer | null>;
}

/** DB-Quelle: liest den nicht widerrufenen Refresh-Token aus core.google_credentials. */
export function dbCredentialSource(db: Db): CredentialSource {
  return {
    async getRefreshToken(userId) {
      const [row] = await db
        .select({ enc: googleCredentials.refreshTokenEnc })
        .from(googleCredentials)
        .where(and(eq(googleCredentials.userId, userId), isNull(googleCredentials.revokedAt)))
        .limit(1);
      return row ? Buffer.from(row.enc) : null;
    },
  };
}

export interface GoogleTokenProviderDeps {
  readonly refresher: GoogleTokenRefresher;
  readonly credentials: CredentialSource;
  /** 32-Byte-Schlüssel (AES-256) aus einem eingehängten Secret. */
  readonly encryptionKey: Buffer;
  readonly now?: () => number;
  /** Vorlaufzeit, ab der vor Ablauf erneuert wird (Vorgabe 60 s). */
  readonly skewMs?: number;
}

export class GoogleTokenProvider {
  readonly #refresher: GoogleTokenRefresher;
  readonly #credentials: CredentialSource;
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #skewMs: number;
  readonly #cache = new Map<number, { token: string; expiresAt: number }>();

  constructor(deps: GoogleTokenProviderDeps) {
    this.#refresher = deps.refresher;
    this.#credentials = deps.credentials;
    this.#key = deps.encryptionKey;
    this.#now = deps.now ?? (() => Date.now());
    this.#skewMs = deps.skewMs ?? 60_000;
  }

  /** Gültiger Google-Access-Token für den Nutzer; aus dem Cache oder frisch geholt. */
  async forUser(userId: number): Promise<string> {
    const cached = this.#cache.get(userId);
    if (cached && cached.expiresAt - this.#skewMs > this.#now()) return cached.token;

    const enc = await this.#credentials.getRefreshToken(userId);
    if (!enc) throw new Error(`Keine Google-Verknüpfung für Nutzer ${userId}.`);
    const refreshToken = decryptSecret(enc, this.#key);
    const { accessToken, expiresInSec } = await this.#refresher.refreshAccessToken(refreshToken);
    this.#cache.set(userId, { token: accessToken, expiresAt: this.#now() + expiresInSec * 1000 });
    return accessToken;
  }

  /** Entfernt einen Nutzer aus dem Cache (z. B. nach Widerruf). */
  invalidate(userId: number): void {
    this.#cache.delete(userId);
  }
}
