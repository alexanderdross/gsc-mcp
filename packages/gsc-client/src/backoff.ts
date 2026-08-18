/**
 * Exponentieller Backoff mit optionalem Jitter ([docs/04]). Rein und deterministisch
 * (der Jitter kommt aus einer injizierbaren Zufallsquelle), damit das Retry-Verhalten
 * testbar bleibt.
 */

export interface BackoffOptions {
  /** Wartezeit des ersten Versuchs in ms. Default 1000. */
  readonly baseMs?: number;
  /** Obergrenze je Wartezeit in ms. Default 300_000 (5 min). */
  readonly capMs?: number;
  /** Jitter-Anteil 0..1; 0 = kein Jitter. Default 0.2. */
  readonly jitter?: number;
}

/**
 * Wartezeit vor dem `attempt`-ten Wiederholungsversuch (0-basiert): base·2^attempt,
 * gekappt bei capMs, dann um bis zu ±jitter·wert gestreut. `rng` liefert [0,1).
 */
export function backoffMs(
  attempt: number,
  opts: BackoffOptions = {},
  rng: () => number = () => 0.5,
): number {
  const base = opts.baseMs ?? 1000;
  const cap = opts.capMs ?? 300_000;
  const jitter = opts.jitter ?? 0.2;

  const raw = Math.min(cap, base * 2 ** attempt);
  const spread = raw * jitter;
  // rng in [0,1) → Verschiebung in [-spread, +spread]
  return Math.max(0, raw + (rng() * 2 - 1) * spread);
}

export interface RetryOptions extends BackoffOptions {
  /** Höchstzahl der Versuche insgesamt. Default 5. */
  readonly maxAttempts?: number;
  /** Wird zum Warten aufgerufen; injizierbar für Tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rng?: () => number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Führt `fn` aus und wiederholt, solange der geworfene Fehler `retryable` meldet
 * und Versuche übrig sind. Nicht wiederholbare Fehler werden sofort weitergereicht.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const sleep = opts.sleep ?? realSleep;
  const rng = opts.rng ?? (() => 0.5);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable =
        typeof err === "object" && err !== null && "retryable" in err
          ? Boolean((err as { retryable: unknown }).retryable)
          : false;
      if (!retryable || attempt === maxAttempts - 1) throw err;
      await sleep(backoffMs(attempt, opts, rng));
    }
  }
  throw lastError;
}
