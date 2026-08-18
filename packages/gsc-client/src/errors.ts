/**
 * Übersetzt Fehler der Search Console API in getippte Domänenfehler ([docs/04]).
 * Der Aufrufer (Sync-Worker, Live-Fallback) entscheidet daran, ob er zurückstellt,
 * neu verbindet oder wiederholt — statt an rohen HTTP-Codes zu raten.
 */

export type GscErrorKind =
  | "rate_limited" // 429 / userRateLimitExceeded — Backoff, Rate senken
  | "quota_exceeded" // 403 quotaExceeded — Tageskontingent, bis morgen pausieren
  | "invalid_grant" // 401 / invalid_grant — Nutzer muss neu verbinden
  | "forbidden" // 403 forbidden — Zugriff auf die Property verloren
  | "not_found" // 404
  | "server" // 5xx — begrenzt wiederholen
  | "bad_request" // 400 — nicht wiederholen, Programmfehler
  | "unknown";

export class GscError extends Error {
  constructor(
    readonly kind: GscErrorKind,
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "GscError";
  }

  /** Ob ein erneuter Versuch überhaupt Sinn ergibt. */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "server";
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

/**
 * Klassifiziert eine fehlgeschlagene API-Antwort. `reason` stammt aus dem
 * `errors[].reason`-Feld der Google-Antwort und trennt Fälle, die derselbe
 * HTTP-Code sonst vermischt (403 quotaExceeded vs. 403 forbidden).
 */
export function classifyGscError(status: number, body: unknown): GscError {
  const parsed = (body ?? {}) as GoogleErrorBody;
  const reason = parsed.error?.errors?.[0]?.reason;
  const message =
    parsed.error?.message ?? `Search Console API antwortete mit ${status}`;

  switch (status) {
    case 400:
      return new GscError("bad_request", status, message, reason);
    case 401:
      return new GscError("invalid_grant", status, message, reason);
    case 403:
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        return new GscError("quota_exceeded", status, message, reason);
      }
      if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
        return new GscError("rate_limited", status, message, reason);
      }
      return new GscError("forbidden", status, message, reason);
    case 404:
      return new GscError("not_found", status, message, reason);
    case 429:
      return new GscError("rate_limited", status, message, reason);
    default:
      if (status >= 500) return new GscError("server", status, message, reason);
      return new GscError("unknown", status, message, reason);
  }
}
