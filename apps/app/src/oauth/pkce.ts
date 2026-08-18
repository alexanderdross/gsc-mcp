/**
 * PKCE (RFC 7636) — Proof Key for Code Exchange ([docs/02]). OAuth 2.1 verlangt es;
 * `S256` ist Pflicht, `plain` nur als Rückfall zugelassen. Verhindert, dass ein
 * abgefangener Authorization-Code ohne den zugehörigen Verifier eingelöst werden kann.
 */

import { createHash } from "node:crypto";

export type PkceMethod = "S256" | "plain";

/** Errechnet die Code-Challenge zu einem Verifier. */
export function computeChallenge(verifier: string, method: PkceMethod): string {
  if (method === "plain") return verifier;
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Prüft, ob Verifier und gespeicherte Challenge zusammenpassen. */
export function verifyPkce(verifier: string, challenge: string, method: PkceMethod): boolean {
  return computeChallenge(verifier, method) === challenge;
}
