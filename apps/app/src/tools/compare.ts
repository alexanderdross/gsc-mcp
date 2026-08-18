/**
 * compare_periods ([docs/05], [docs/06]) — der sichtbarste Beleg für „rechnen statt
 * schätzen". Zerlegt die Klickveränderung zwischen zwei Zeiträumen in Nachfrage- und
 * CTR-Anteil und benennt die Segmente, die den größten Beitrag leisten. Die Zerlegung
 * summiert sich exakt zum Gesamteffekt ([packages/analytics]).
 */

import { z } from "zod";
import { attributeBySegment } from "@gsc/analytics";
import { defineTool } from "../tool.ts";
import { rowCap } from "../budget.ts";
import { view } from "../format.ts";
import type { WarehouseRepo, Dimension } from "../repo.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const period = z.object({ from: isoDate, to: isoDate }).strict();

export function makeComparePeriods(repo: WarehouseRepo) {
  return defineTool({
    name: "compare_periods",
    annotations: { title: "Zeiträume vergleichen", readOnlyHint: true },
    input: z
      .object({
        dimension: z.enum(["query", "page", "country", "device"]).default("query"),
        a: period,
        b: period,
        search_type: z.string().default("web"),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "compare_periods" },
    async handler(ctx, input) {
      const cap = Math.min(input.limit ?? rowCap(ctx.plan, ctx.detail), rowCap(ctx.plan, ctx.detail));
      const pairs = await repo.segmentPairs(
        ctx.propertyId!,
        input.dimension as Dimension,
        input.a,
        input.b,
        input.search_type,
      );

      const attribution = attributeBySegment(
        pairs.map((p) => ({ key: p.key, a: p.a, b: p.b })),
        cap,
      );

      const totalA = sum(pairs.map((p) => p.a));
      const totalB = sum(pairs.map((p) => p.b));

      return {
        dimension: input.dimension,
        periodA: { ...input.a, ...view(totalA) },
        periodB: { ...input.b, ...view(totalB) },
        change: attribution.total,
        contributors: attribution.contributors,
      };
    },
  });
}

function sum(facts: readonly { clicks: number; impressions: number; positionSum: number }[]) {
  return facts.reduce(
    (acc, f) => ({
      clicks: acc.clicks + f.clicks,
      impressions: acc.impressions + f.impressions,
      positionSum: acc.positionSum + f.positionSum,
    }),
    { clicks: 0, impressions: 0, positionSum: 0 },
  );
}
