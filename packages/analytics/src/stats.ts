/**
 * Robuste Statistik-Grundlagen für die Analyse-Engine ([docs/06]). Bewusst
 * median-/MAD-basiert statt Mittelwert/Standardabweichung, damit einzelne
 * Ausreißer — genau das, was gefunden werden soll — die Baseline nicht verbiegen.
 */

/** Median einer Zahlenreihe. Leere Reihe ⇒ 0. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Median der absoluten Abweichungen vom Median. */
export function mad(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** MAD skaliert auf die Standardabweichung einer Normalverteilung. */
export function robustScale(values: readonly number[]): number {
  return 1.4826 * mad(values);
}

/**
 * Theil-Sen-Steigung: Median aller paarweisen Steigungen. Robust gegen einzelne
 * Ausreißer, anders als die gewöhnliche Regression ([docs/06] §6).
 */
export function theilSen(points: readonly { x: number; y: number }[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j]!.x - points[i]!.x;
      if (dx !== 0) slopes.push((points[j]!.y - points[i]!.y) / dx);
    }
  }
  return slopes.length === 0 ? 0 : median(slopes);
}

/**
 * Poisson-Verteilungsfunktion P(X ≤ k) bei Erwartungswert λ. Für die Behandlung
 * kleiner Klickzahlen ([docs/06] §2), wo die Normalverteilungsannahme unbrauchbar
 * ist. Iterativ, ohne Fakultät-Überlauf.
 */
export function poissonCdf(k: number, lambda: number): number {
  if (lambda <= 0) return k >= 0 ? 1 : 0;
  const kk = Math.floor(k);
  if (kk < 0) return 0;
  let term = Math.exp(-lambda); // P(X = 0)
  let sum = term;
  for (let i = 1; i <= kk; i++) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

/** Wochentag (0 = Sonntag) eines ISO-Datums, in UTC. */
export function weekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}
