/**
 * Symmetrische Verschlüsselung des Google-Refresh-Tokens ([docs/02], [docs/08]).
 * AES-256-GCM; das Blob-Layout `iv || ciphertext || tag` entspricht exakt dem, was die
 * Migration für `core.google_credentials.refresh_token_enc` dokumentiert. Der Schlüssel
 * liegt in einer eingehängten Datei/Secret, nie im Repository.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM-Standard
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

/** Verschlüsselt Klartext zu `iv || ciphertext || tag`. */
export function encryptSecret(plaintext: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Schlüssel muss ${KEY_BYTES} Byte lang sein (AES-256).`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

/** Entschlüsselt ein `iv || ciphertext || tag`-Blob; wirft bei Manipulation. */
export function decryptSecret(blob: Buffer, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Schlüssel muss ${KEY_BYTES} Byte lang sein (AES-256).`);
  }
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Chiffrat zu kurz.");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
