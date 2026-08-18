/**
 * Verknüpfung mit der Google-Identität ([docs/02] Ebene 2). Reine Schnittstellen — die
 * echten Aufrufe (Google-Consent-URL, Code-Tausch, verschlüsselte Ablage des
 * Refresh-Tokens) folgen mit der laufenden Verdrahtung. Der Google-Refresh-Token
 * verlässt den Server nie; das an den Client ausgegebene Token trägt nur `user_id` und
 * Scope ([docs/02]).
 */

/** Was der Code-Tausch bei Google liefert. */
export interface GoogleIdentity {
  readonly googleSub: string; // stabile Identität, nicht die E-Mail
  readonly email: string;
  /** Nur beim ersten Consent vorhanden (access_type=offline, prompt=consent). */
  readonly refreshToken?: string;
  readonly scopes: readonly string[];
}

export interface GoogleAuth {
  /** URL der Google-Zustimmung, mit unserem `state` und den angefragten Scopes. */
  authorizeUrl(state: string, scopes: readonly string[]): string;
  /** Tauscht den Google-Authorization-Code gegen Identität und Refresh-Token. */
  exchange(code: string): Promise<GoogleIdentity>;
}

/** Legt den Nutzer an bzw. findet ihn und speichert den Google-Refresh-Token (verschlüsselt). */
export interface UserDirectory {
  linkGoogle(identity: GoogleIdentity): Promise<{ userId: number }>;
}
