/**
 * Persistentes `UserDirectory` ([docs/02] Ebene 2, [docs/08]). Verknüpft die
 * Google-Identität mit einem Konto (`core.users`, Upsert über `google_sub`) und legt den
 * Google-Refresh-Token AES-256-GCM-verschlüsselt ab (`core.google_credentials`). Der
 * Klartext-Token verlässt diese Grenze nie. Liegt am Kompositionspunkt (apps/app), weil
 * es `packages/db` und die Krypto-Utility (`crypto.ts`) verbindet.
 */

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema, type Db } from "@gsc/db";
import type { UserDirectory, GoogleIdentity } from "./google.ts";
import { encryptSecret } from "./crypto.ts";

const { users, googleCredentials } = schema;

export interface DbUserDirectoryDeps {
  readonly db: Db;
  /** 32-Byte-Schlüssel (AES-256) aus einem eingehängten Secret. */
  readonly encryptionKey: Buffer;
  /** Öffentliche ID neuer Nutzer (Vorgabe: zufällige UUID). */
  readonly newPublicId?: () => string;
}

export class DbUserDirectory implements UserDirectory {
  readonly #db: Db;
  readonly #key: Buffer;
  readonly #newPublicId: () => string;

  constructor(deps: DbUserDirectoryDeps) {
    this.#db = deps.db;
    this.#key = deps.encryptionKey;
    this.#newPublicId = deps.newPublicId ?? randomUUID;
  }

  async linkGoogle(identity: GoogleIdentity): Promise<{ userId: number }> {
    // Nutzer per google_sub anlegen oder finden; E-Mail aktualisieren.
    const [u] = await this.#db
      .insert(users)
      .values({ publicId: this.#newPublicId(), googleSub: identity.googleSub, email: identity.email })
      .onConflictDoUpdate({ target: users.googleSub, set: { email: identity.email } })
      .returning({ id: users.id });
    const userId = u!.id;

    // Refresh-Token nur ablegen, wenn Google einen geliefert hat (fehlt bei erneutem
    // Consent ohne prompt=consent). Verschlüsselt, mit Scopes; Widerruf zurücksetzen.
    if (identity.refreshToken) {
      const enc = encryptSecret(identity.refreshToken, this.#key);
      await this.#db
        .insert(googleCredentials)
        .values({ userId, refreshTokenEnc: enc, scopes: [...identity.scopes] })
        .onConflictDoUpdate({
          target: googleCredentials.userId,
          set: { refreshTokenEnc: enc, scopes: [...identity.scopes], revokedAt: null },
        });
    }

    return { userId };
  }
}
