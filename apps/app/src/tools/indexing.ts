/**
 * Indexierungs- und Sitemap-Tools ([docs/05]). Als Fabriken über ein injiziertes
 * `IndexingRepo`, das GSC-Client, Inspektions-Cache und Tagesbudget kapselt. Die
 * Handler-Logik ist damit ohne Netzwerk und ohne Datenbank testbar.
 */

import { z } from "zod";
import { defineTool } from "../tool.ts";
import {
  planInspectionBatch,
  summarizeCoverage,
  type InspectionRecord,
  type Sitemap,
} from "../indexing.ts";

export interface InspectionBudget {
  readonly remaining: number;
  /** Zeitpunkt, zu dem das Tagesbudget zurückgesetzt wird (UTC-Mitternacht). */
  readonly resetAt: string;
}

export interface IndexingRepo {
  /** Live-Inspektion mit Cache; `forceRefresh` verbraucht Kontingent. */
  inspect(propertyId: number, url: string, forceRefresh: boolean): Promise<InspectionRecord>;
  /** Nach Priorität sortierte URL-Kandidaten für die Massen-Inspektion. */
  bulkCandidates(propertyId: number, select: string): Promise<readonly string[]>;
  inspectionBudget(propertyId: number): Promise<InspectionBudget>;
  /** Reiht URLs zur Inspektion ein und antwortet sofort ([docs/04]). */
  enqueueInspections(propertyId: number, urls: readonly string[]): Promise<void>;
  listSitemaps(propertyId: number): Promise<readonly Sitemap[]>;
  submitSitemap(propertyId: number, sitemapUrl: string): Promise<void>;
  /** Gespeicherte Inspektionen für den Coverage-Überblick. */
  inspectionRecords(propertyId: number): Promise<readonly InspectionRecord[]>;
}

export function makeInspectUrl(repo: IndexingRepo) {
  return defineTool({
    name: "inspect_url",
    annotations: { title: "URL-Inspektion", readOnlyHint: true },
    input: z.object({ url: z.string().url(), force_refresh: z.boolean().default(false) }).strict(),
    requires: { needsProperty: true },
    async handler(ctx, input) {
      return repo.inspect(ctx.propertyId!, input.url, input.force_refresh);
    },
  });
}

export function makeBulkInspectUrls(repo: IndexingRepo) {
  return defineTool({
    name: "bulk_inspect_urls",
    annotations: { title: "URLs stapelweise inspizieren", readOnlyHint: true },
    input: z
      .object({
        urls: z.array(z.string().url()).optional(),
        select: z
          .enum(["top_traffic", "losing_traffic", "never_inspected", "stale"])
          .default("top_traffic"),
        max_urls: z.number().int().positive().optional(),
      })
      .strict(),
    requires: { needsProperty: true },
    async handler(ctx, input) {
      const candidates = input.urls ?? (await repo.bulkCandidates(ctx.propertyId!, input.select));
      const budget = await repo.inspectionBudget(ctx.propertyId!);
      const plan = planInspectionBatch(candidates, budget.remaining, input.max_urls);
      await repo.enqueueInspections(ctx.propertyId!, plan.planned);
      return {
        planned: plan.planned.length,
        deferred: plan.deferred,
        budgetRemaining: budget.remaining - plan.planned.length,
        resetAt: budget.resetAt,
      };
    },
  });
}

export function makeIndexCoverageOverview(repo: IndexingRepo) {
  return defineTool({
    name: "index_coverage_overview",
    annotations: { title: "Indexierungs-Überblick", readOnlyHint: true },
    input: z
      .object({ group_by: z.enum(["verdict", "coverage_state", "directory"]).default("verdict") })
      .strict(),
    requires: { needsProperty: true },
    async handler(ctx, input) {
      const records = await repo.inspectionRecords(ctx.propertyId!);
      return { inspected: records.length, groupBy: input.group_by, buckets: summarizeCoverage(records, input.group_by) };
    },
  });
}

export function makeListSitemaps(repo: IndexingRepo) {
  return defineTool({
    name: "list_sitemaps",
    annotations: { title: "Sitemaps auflisten", readOnlyHint: true },
    input: z.object({}).strict(),
    requires: { needsProperty: true },
    async handler(ctx) {
      return { sitemaps: await repo.listSitemaps(ctx.propertyId!) };
    },
  });
}

export function makeSubmitSitemap(repo: IndexingRepo) {
  return defineTool({
    name: "submit_sitemap",
    // Das einzige schreibende Tool. Einreichen ist additiv, nicht destruktiv.
    annotations: { title: "Sitemap einreichen", readOnlyHint: false, destructiveHint: false },
    input: z
      .object({ sitemap_url: z.string().url(), confirm: z.literal(true) })
      .strict(),
    requires: { needsProperty: true },
    async handler(ctx, input) {
      await repo.submitSitemap(ctx.propertyId!, input.sitemap_url);
      return { submitted: input.sitemap_url };
    },
  });
}
