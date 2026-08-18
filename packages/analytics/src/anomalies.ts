/**
 * Anomalie-Erkennung ([docs/06] §2). Trennt echte Ereignisse von Wochenendmustern,
 * Feiertagen und Zufallsschwankung: Wochentagsmuster herausrechnen, robuste Baseline
 * über 28 Tage (Median + MAD), Z-Score — und für kleine Klickzahlen ein exakter
 * Poisson-Test statt der dort unbrauchbaren Normalverteilungsannahme.
 */

import { median, robustScale, poissonCdf, weekday } from "./stats.ts";

export interface SeriesPoint {
  readonly date: string; // YYYY-MM-DD
  readonly clicks: number;
}

export type Sensitivity = "low" | "medium" | "high";

export interface AnomalyOptions {
  readonly sensitivity?: Sensitivity;
  readonly baselineDays?: number; // Vorgabe 28
  /** Baseline-Schwelle, unter der der Poisson-Pfad greift. Vorgabe 30. */
  readonly smallCount?: number;
}

export interface Anomaly {
  readonly date: string;
  readonly value: number;
  readonly expected: number;
  readonly z: number | null; // null im Poisson-Pfad
  readonly deltaPct: number;
  readonly kind: "drop" | "spike";
}

interface Threshold {
  z: number;
  minPct: number;
  minAbs: number;
  alpha: number;
}

const THRESHOLDS: Record<Sensitivity, Threshold> = {
  low: { z: 3.5, minPct: 0.2, minAbs: 50, alpha: 0.001 },
  medium: { z: 3.0, minPct: 0.15, minAbs: 20, alpha: 0.01 },
  high: { z: 2.5, minPct: 0.1, minAbs: 10, alpha: 0.05 },
};

/**
 * Rechnet das Wochentagsmuster heraus ([docs/06] §2, Schritt 1). Liefert die
 * saisonbereinigte Reihe y*. Median statt Mittelwert, damit ein Ausreißer das
 * Wochentagsprofil nicht verbiegt.
 */
export function seasonalAdjust(series: readonly SeriesPoint[]): number[] {
  const n = series.length;
  const clicks = series.map((p) => p.clicks);

  // Zentrierter 7-Tage-Median als Trend.
  const trend = clicks.map((_, i) => {
    const lo = Math.max(0, i - 3);
    const hi = Math.min(n - 1, i + 3);
    return median(clicks.slice(lo, hi + 1));
  });

  const ratio = clicks.map((c, i) => (trend[i]! > 0 ? c / trend[i]! : 1));

  // Median-Ratio je Wochentag.
  const perDay = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const w = weekday(series[i]!.date);
    const list = perDay.get(w) ?? [];
    list.push(ratio[i]!);
    perDay.set(w, list);
  }
  const factor = new Map<number, number>();
  for (let w = 0; w < 7; w++) {
    const list = perDay.get(w);
    factor.set(w, list && list.length > 0 ? median(list) : 1);
  }
  // Auf Mittelwert 1 normieren.
  const mean = [...factor.values()].reduce((a, b) => a + b, 0) / 7;
  if (mean > 0) for (const [w, f] of factor) factor.set(w, f / mean);

  return clicks.map((c, i) => {
    const f = factor.get(weekday(series[i]!.date))!;
    return f > 0 ? c / f : c;
  });
}

export function detectAnomalies(
  series: readonly SeriesPoint[],
  opts: AnomalyOptions = {},
): Anomaly[] {
  const t = THRESHOLDS[opts.sensitivity ?? "medium"];
  const window = opts.baselineDays ?? 28;
  const smallCount = opts.smallCount ?? 30;
  const yStar = seasonalAdjust(series);

  const out: Anomaly[] = [];
  for (let i = window; i < series.length; i++) {
    const past = yStar.slice(i - window, i);
    const baseline = median(past);
    const value = yStar[i]!;
    const deltaPct = baseline > 0 ? (value - baseline) / baseline : 0;
    const absDelta = Math.abs(value - baseline);
    if (absDelta < t.minAbs || Math.abs(deltaPct) < t.minPct) continue;

    const kind: Anomaly["kind"] = value < baseline ? "drop" : "spike";

    if (baseline < smallCount) {
      // Poisson-Pfad auf den Rohklicks.
      const rawBaseline = median(series.slice(i - window, i).map((p) => p.clicks));
      const clicks = series[i]!.clicks;
      const p =
        kind === "drop"
          ? poissonCdf(clicks, rawBaseline)
          : 1 - poissonCdf(clicks - 1, rawBaseline);
      if (p < t.alpha) {
        out.push({ date: series[i]!.date, value: clicks, expected: rawBaseline, z: null, deltaPct, kind });
      }
      continue;
    }

    const scale = robustScale(past);
    // Perfekt stabile Baseline (scale 0): jede reale Abweichung ist auffällig.
    const z = scale > 0 ? (value - baseline) / scale : value === baseline ? 0 : Infinity * Math.sign(value - baseline);
    if (Math.abs(z) >= t.z) {
      out.push({ date: series[i]!.date, value, expected: baseline, z, deltaPct, kind });
    }
  }
  return out;
}
