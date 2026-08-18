/**
 * Token-Bucket-Rate-Limiter ([docs/04]). In der Cloudflare-Fassung war dafür ein
 * Durable Object nötig; auf einem Server genügt ein Bucket-Zustand, der in
 * `core.rate_budget` persistiert und mit `SELECT … FOR UPDATE` fortgeschrieben wird.
 *
 * Diese Datei enthält die reine Rechenlogik — Nachfüllen und Entnehmen —, getrennt
 * von der Persistenz, damit sie ohne Datenbank und ohne Uhr getestet werden kann.
 */

export interface BucketState {
  /** Aktuell verfügbare Token. */
  readonly tokens: number;
  /** Zeitpunkt der letzten Berechnung (ms seit Epoche). */
  readonly updatedAt: number;
}

export interface BucketConfig {
  /** Nachfüllrate in Token pro Sekunde. */
  readonly ratePerSecond: number;
  /** Maximale Token (Burst-Kapazität). */
  readonly burst: number;
}

/** Füllt den Bucket auf den Stand zur Zeit `now` auf (reine Funktion). */
export function refill(state: BucketState, config: BucketConfig, now: number): BucketState {
  const elapsedSec = Math.max(0, (now - state.updatedAt) / 1000);
  const tokens = Math.min(config.burst, state.tokens + elapsedSec * config.ratePerSecond);
  return { tokens, updatedAt: now };
}

export interface TakeResult {
  readonly state: BucketState;
  readonly granted: boolean;
  /** Wartezeit in ms, bis `count` Token verfügbar wären (0, wenn gewährt). */
  readonly retryAfterMs: number;
}

/**
 * Versucht, `count` Token zu entnehmen. Gewährt und zieht ab, wenn genug da sind;
 * andernfalls unverändert plus Angabe, wie lange bis zur Verfügbarkeit zu warten ist.
 */
export function take(
  state: BucketState,
  config: BucketConfig,
  now: number,
  count = 1,
): TakeResult {
  const filled = refill(state, config, now);
  if (filled.tokens >= count) {
    return {
      state: { tokens: filled.tokens - count, updatedAt: now },
      granted: true,
      retryAfterMs: 0,
    };
  }
  const missing = count - filled.tokens;
  const retryAfterMs = Math.ceil((missing / config.ratePerSecond) * 1000);
  return { state: filled, granted: false, retryAfterMs };
}

/**
 * Adaptive Anpassung ([docs/04]): Jede 429/quota-Antwort senkt die effektive Rate,
 * längere Fehlerfreiheit hebt sie wieder an — verlässlicher als eine abgeschriebene
 * Google-Zahl, die morgen falsch sein kann.
 */
export function adjustRate(
  current: number,
  outcome: "throttled" | "ok",
  bounds: { min: number; max: number },
): number {
  const next = outcome === "throttled" ? current * 0.5 : current * 1.1;
  return Math.min(bounds.max, Math.max(bounds.min, next));
}
