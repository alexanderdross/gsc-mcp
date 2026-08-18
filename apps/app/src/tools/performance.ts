/**
 * Datentragende Performance-Tools ([docs/05]). Als Fabriken über ein injiziertes
 * Warehouse-Repository — die Handler-Logik (Budget, Herkunft, anonymisierter Anteil,
 * Sortierung) ist damit ohne Datenbank testbar.
 */

import { z } from "zod";
import { avgPosition, type Fact } from "@gsc/core";
import { defineTool } from "../tool.ts";
import { rowCap } from "../budget.ts";
import { view, viewRow, anonymizedShare } from "../format.ts";
import type { WarehouseRepo, Dimension } from "../repo.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const dimension = z.enum(["query", "page", "country", "device"]);
const period = z.object({ from: isoDate, to: isoDate }).strict();

export function makeSearchPerformance(repo: WarehouseRepo) {
  return defineTool({
    name: "search_performance",
    annotations: { title: "Search Performance", readOnlyHint: true },
    input: z
      .object({
        dimension: dimension.default("query"),
        from: isoDate,
        to: isoDate,
        search_type: z.string().default("web"),
        query_contains: z.string().optional(),
        sort_by: z.enum(["clicks", "impressions", "position"]).default("clicks"),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
    requires: { needsProperty: true },
    async handler(ctx, input) {
      const cap = rowCap(ctx.plan, ctx.detail);
      const limit = Math.min(input.limit ?? cap, cap);
      const result = await repo.performance({
        propertyId: ctx.propertyId!,
        dimension: input.dimension as Dimension,
        period: { from: input.from, to: input.to },
        searchType: input.search_type,
        ...(input.query_contains === undefined ? {} : { queryContains: input.query_contains }),
        sortBy: input.sort_by,
        limit,
      });

      return {
        source: result.source,
        covered: result.covered,
        dimension: input.dimension,
        totals: view(result.totals),
        anonymizedImpressionsShare: anonymizedShare(
          result.anonymizedImpressions,
          result.totals.impressions,
        ),
        rowLimit: limit,
        rows: result.rows.map(viewRow),
      };
    },
  });
}

/** Metrikwert einer Faktenzeile; Position kann fehlen (0 Impressionen). */
function metric(f: Fact, m: "clicks" | "impressions" | "position"): number | null {
  if (m === "clicks") return f.clicks;
  if (m === "impressions") return f.impressions;
  return avgPosition(f);
}

/** Bei Position ist kleiner besser; sonst größer. */
function isImprovement(delta: number, m: string): boolean {
  return m === "position" ? delta < 0 : delta > 0;
}

export function makeTopMovers(repo: WarehouseRepo) {
  return defineTool({
    name: "top_movers",
    annotations: { title: "Top Movers", readOnlyHint: true },
    input: z
      .object({
        dimension: dimension.default("query"),
        a: period,
        b: period,
        metric: z.enum(["clicks", "impressions", "position"]).default("clicks"),
        direction: z.enum(["up", "down", "both"]).default("both"),
        min_impressions: z.number().int().nonnegative().default(100),
        search_type: z.string().default("web"),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "top_movers" },
    async handler(ctx, input) {
      const cap = rowCap(ctx.plan, ctx.detail);
      const pairs = await repo.segmentPairs(
        ctx.propertyId!,
        input.dimension as Dimension,
        input.a,
        input.b,
        input.search_type,
      );

      const movers = pairs
        .map((p) => {
          const va = metric(p.a, input.metric);
          const vb = metric(p.b, input.metric);
          return { key: p.key, a: p.a, b: p.b, va, vb };
        })
        .filter((m) => m.va !== null && m.vb !== null)
        .filter((m) => Math.max(m.a.impressions, m.b.impressions) >= input.min_impressions)
        .map((m) => ({ ...m, delta: (m.vb as number) - (m.va as number) }))
        .filter((m) =>
          input.direction === "both"
            ? m.delta !== 0
            : isImprovement(m.delta, input.metric) === (input.direction === "up"),
        )
        .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
        .slice(0, cap);

      return {
        metric: input.metric,
        direction: input.direction,
        rows: movers.map((m) => ({
          key: m.key,
          delta: m.delta,
          a: view(m.a),
          b: view(m.b),
        })),
      };
    },
  });
}
