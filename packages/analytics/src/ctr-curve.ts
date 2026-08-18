/**
 * Site-eigene CTR-nach-Position-Kurve ([docs/06] §3). Generische Branchentabellen
 * sind für die Bewertung einer einzelnen Website unbrauchbar; die Kurve wird deshalb
 * aus den eigenen Daten geschätzt und per isotoner Regression (Pool-Adjacent-Violators)
 * monoton fallend erzwungen — lokale Umkehrungen aus dünnen Buckets werden geglättet,
 * ohne die Kurve durch eine willkürliche Funktionsform zu verfälschen.
 */

import { ctr, type Fact } from "@gsc/core";

export interface CtrObservation extends Fact {
  /** Durchschnittsposition dieser Beobachtung (1-basiert). */
  readonly position: number;
}

export interface CurvePoint {
  readonly position: number;
  readonly ctr: number;
}

/** Monoton fallende Stützpunkte, nach Position aufsteigend. */
export type CtrCurve = readonly CurvePoint[];

const BUCKET_STEP = 0.5;
const MIN_BUCKET_IMPRESSIONS = 1000;

interface Block {
  weight: number; // Summe der Impressionen
  weightedCtr: number; // Summe (ctr × Impressionen)
  position: number; // gewichtete Durchschnittsposition des Blocks
}

/**
 * Schätzt die CTR-Kurve. Beobachtungen werden in Halbschritt-Buckets gruppiert,
 * je Bucket die impressionsgewichtete CTR gebildet, dünne Buckets mit dem Nachbarn
 * verschmolzen und das Ergebnis isoton (nicht steigend) geregelt.
 *
 * Liefert eine leere Kurve, wenn keine Beobachtungen mit Impressionen vorliegen.
 */
export function fitCtrCurve(observations: readonly CtrObservation[]): CtrCurve {
  const withImpr = observations.filter((o) => o.impressions > 0);
  if (withImpr.length === 0) return [];

  // 1. Buckets nach Halbschritt der Position, impressionsgewichtet aggregiert.
  const buckets = new Map<number, Block>();
  for (const o of withImpr) {
    const bucket = Math.round(o.position / BUCKET_STEP) * BUCKET_STEP;
    const b = buckets.get(bucket) ?? { weight: 0, weightedCtr: 0, position: 0 };
    b.weight += o.impressions;
    b.weightedCtr += ctr(o) * o.impressions;
    b.position += o.position * o.impressions;
    buckets.set(bucket, b);
  }

  let blocks: Block[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => b);

  // 2. Dünne Buckets in den vorherigen Nachbarn ziehen (der erste in den nächsten).
  blocks = mergeThin(blocks);

  // 3. Pool-Adjacent-Violators: nicht steigende Folge erzwingen.
  const pooled = poolAdjacentViolators(blocks);

  return pooled.map((b) => ({
    position: b.position / b.weight,
    ctr: b.weightedCtr / b.weight,
  }));
}

function mergeThin(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.weight < MIN_BUCKET_IMPRESSIONS && out.length > 0) {
      const prev = out[out.length - 1]!;
      prev.weight += b.weight;
      prev.weightedCtr += b.weightedCtr;
      prev.position += b.position;
    } else {
      out.push({ ...b });
    }
  }
  // Ist der allererste Block noch zu dünn (kein Vorgänger vorhanden), in den nächsten ziehen.
  while (out.length >= 2 && out[0]!.weight < MIN_BUCKET_IMPRESSIONS) {
    const [first, second, ...rest] = out;
    out.splice(0, 2, {
      weight: first!.weight + second!.weight,
      weightedCtr: first!.weightedCtr + second!.weightedCtr,
      position: first!.position + second!.position,
    }, ...rest);
  }
  return out;
}

/** Erzwingt eine nicht steigende Folge der Block-Mittelwerte (CTR sinkt mit Position). */
function poolAdjacentViolators(blocks: readonly Block[]): Block[] {
  const stack: Block[] = [];
  for (const b of blocks) {
    let cur: Block = { ...b };
    // Verletzung: der vorige Block hat eine kleinere CTR als der aktuelle → poolen.
    while (stack.length > 0 && mean(stack[stack.length - 1]!) < mean(cur)) {
      const prev = stack.pop()!;
      cur = {
        weight: prev.weight + cur.weight,
        weightedCtr: prev.weightedCtr + cur.weightedCtr,
        position: prev.position + cur.position,
      };
    }
    stack.push(cur);
  }
  return stack;
}

function mean(b: Block): number {
  return b.weightedCtr / b.weight;
}

/**
 * Erwartungswert E(p) für eine Position. Zwischen den Stützpunkten linear
 * interpoliert, außerhalb auf den Randwert geklemmt. Leere Kurve ⇒ 0.
 */
export function expectedCtr(curve: CtrCurve, position: number): number {
  if (curve.length === 0) return 0;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (position <= first.position) return first.ctr;
  if (position >= last.position) return last.ctr;

  for (let i = 1; i < curve.length; i++) {
    const hi = curve[i]!;
    if (position <= hi.position) {
      const lo = curve[i - 1]!;
      const span = hi.position - lo.position;
      if (span === 0) return hi.ctr;
      const t = (position - lo.position) / span;
      return lo.ctr + t * (hi.ctr - lo.ctr);
    }
  }
  return last.ctr;
}
