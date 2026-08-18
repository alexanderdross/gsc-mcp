/**
 * Analyse-Tool-Handler ([docs/05], [docs/06]) — wickeln die reinen Verfahren aus
 * `packages/analytics` über das injizierte Warehouse-Repository ein. Die Handler-Logik
 * (Kurvenschätzung, Budget, Zugriffsstufe) ist ohne Datenbank testbar; die konkrete
 * Repo-Implementierung (`WarehouseRepository`) liegt in `packages/db`.
 */

import { z } from "zod";
import { avgPosition } from "@gsc/core";
import {
  fitCtrCurve,
  strikingDistance,
  ctrOutliers,
  brandSplit,
  contentDecay,
  findCannibalization,
  detectAnomalies,
  type CtrObservation,
} from "@gsc/analytics";
import { defineTool } from "../tool.ts";
import { applyBudget } from "../budget.ts";
import type { WarehouseRepo, Dimension } from "../repo.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

/** Fittet die site-eigene CTR-Kurve aus Faktenzeilen mit Position. */
function curveFrom(rows: readonly (CtrObservation | { clicks: number; impressions: number; positionSum: number })[]) {
  const observations: CtrObservation[] = [];
  for (const r of rows) {
    const position = avgPosition(r);
    if (position !== null) observations.push({ ...r, position });
  }
  return fitCtrCurve(observations);
}

export function makeStrikingDistance(repo: WarehouseRepo) {
  return defineTool({
    name: "striking_distance",
    annotations: { title: "Striking Distance", readOnlyHint: true },
    input: z
      .object({
        from: isoDate,
        to: isoDate,
        search_type: z.string().default("web"),
        position_min: z.number().positive().default(5),
        position_max: z.number().positive().default(20),
        min_impressions: z.number().int().nonnegative().default(100),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "striking_distance" },
    async handler(ctx, input) {
      const perf = await repo.performance({
        propertyId: ctx.propertyId!,
        dimension: "query",
        period: { from: input.from, to: input.to },
        searchType: input.search_type,
        sortBy: "impressions",
        limit: 25_000,
      });
      const curve = curveFrom(perf.rows);
      const result = strikingDistance(perf.rows, curve, {
        positionMin: input.position_min,
        positionMax: input.position_max,
        minImpressions: input.min_impressions,
      });
      const budgeted = applyBudget(result, ctx.plan, ctx.detail);
      return { source: perf.source, covered: perf.covered, ...budgeted };
    },
  });
}

export function makeCtrAnalysis(repo: WarehouseRepo) {
  return defineTool({
    name: "ctr_analysis",
    annotations: { title: "CTR-Analyse", readOnlyHint: true },
    input: z
      .object({
        from: isoDate,
        to: isoDate,
        scope: z.enum(["page", "query"]).default("page"),
        search_type: z.string().default("web"),
        min_impressions: z.number().int().nonnegative().default(500),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "ctr_analysis" },
    async handler(ctx, input) {
      const perf = await repo.performance({
        propertyId: ctx.propertyId!,
        dimension: input.scope as Dimension,
        period: { from: input.from, to: input.to },
        searchType: input.search_type,
        sortBy: "impressions",
        limit: 25_000,
      });
      const result = ctrOutliers(perf.rows, { minImpressions: input.min_impressions });
      const budgeted = applyBudget(result, ctx.plan, ctx.detail);
      return { source: perf.source, covered: perf.covered, ...budgeted };
    },
  });
}

export function makeBrandVsNonbrand(repo: WarehouseRepo) {
  return defineTool({
    name: "brand_vs_nonbrand",
    annotations: { title: "Brand vs. Non-Brand", readOnlyHint: true },
    input: z
      .object({
        from: isoDate,
        to: isoDate,
        pattern: z.string().min(1),
        search_type: z.string().default("web"),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "brand_vs_nonbrand" },
    async handler(ctx, input) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(input.pattern, "i");
      } catch {
        throw new Error(`Ungültiges Marken-Muster (Regex): ${input.pattern}`);
      }
      const perf = await repo.performance({
        propertyId: ctx.propertyId!,
        dimension: "query",
        period: { from: input.from, to: input.to },
        searchType: input.search_type,
        sortBy: "clicks",
        limit: 25_000,
      });
      const anonymized = perf.anonymized ?? { clicks: 0, impressions: perf.anonymizedImpressions, positionSum: 0 };
      const split = brandSplit(perf.rows, pattern, anonymized);
      return { source: perf.source, covered: perf.covered, ...split };
    },
  });
}

export function makeDetectAnomalies(repo: WarehouseRepo) {
  return defineTool({
    name: "detect_anomalies",
    annotations: { title: "Anomalien erkennen", readOnlyHint: true },
    input: z
      .object({
        from: isoDate,
        to: isoDate,
        search_type: z.string().default("web"),
        sensitivity: z.enum(["low", "medium", "high"]).default("medium"),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "detect_anomalies" },
    async handler(ctx, input) {
      const series = await repo.timeseries(
        ctx.propertyId!,
        { from: input.from, to: input.to },
        input.search_type,
      );
      const anomalies = detectAnomalies(series, { sensitivity: input.sensitivity });
      const budgeted = applyBudget(anomalies, ctx.plan, ctx.detail);
      return { days: series.length, ...budgeted };
    },
  });
}

export function makeFindCannibalization(repo: WarehouseRepo) {
  return defineTool({
    name: "find_cannibalization",
    annotations: { title: "Kannibalisierung finden", readOnlyHint: true },
    input: z
      .object({
        from: isoDate,
        to: isoDate,
        search_type: z.string().default("web"),
        min_impressions: z.number().int().nonnegative().default(100),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "find_cannibalization" },
    async handler(ctx, input) {
      const rows = await repo.cannibalizationRows(
        ctx.propertyId!,
        { from: input.from, to: input.to },
        input.search_type,
      );
      const curve = curveFrom(rows);
      const result = findCannibalization(rows, curve, { minImpressions: input.min_impressions });
      const budgeted = applyBudget(result, ctx.plan, ctx.detail);
      return budgeted;
    },
  });
}

export function makeContentDecay(repo: WarehouseRepo) {
  return defineTool({
    name: "content_decay",
    annotations: { title: "Content Decay", readOnlyHint: true },
    input: z
      .object({
        search_type: z.string().default("web"),
        min_prior_clicks: z.number().int().nonnegative().default(100),
      })
      .strict(),
    requires: { needsProperty: true, analysisTool: "content_decay" },
    async handler(ctx, input) {
      const { pages, siteYoy } = await repo.decayInputs(ctx.propertyId!, input.search_type);
      const result = contentDecay(pages, siteYoy, { minPriorClicks: input.min_prior_clicks });
      const budgeted = applyBudget(result, ctx.plan, ctx.detail);
      return { siteYoy, ...budgeted };
    },
  });
}
