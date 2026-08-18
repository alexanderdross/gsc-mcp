/**
 * Konkrete `IndexingRepo`-Implementierung ([docs/04], [docs/05]). Anders als das reine
 * Warehouse-Repository ist dies ein *zusammengesetzter* Adapter: Live-Aufrufe an die
 * Search Console (`@gsc/gsc-client`), der Inspektions-Cache und das Tagesbudget in
 * PostgreSQL (`@gsc/db`) sowie eine injizierte Warteschlange für die asynchrone
 * Massen-Inspektion. Er lebt daher am Kompositionspunkt (apps/app), nicht in einem der
 * beiden Datenpakete.
 *
 * Budget-Konvention ([docs/04]): Jede Inspektion erhöht den Tageszähler genau einmal —
 * Live-Inspektionen beim Ausführen, in die Queue gestellte beim Einreihen (Reservierung).
 * So sieht `bulk_inspect_urls` über mehrere Aufrufe hinweg das real verbleibende Budget.
 */

import { and, eq, desc, sql } from "drizzle-orm";
import { schema, type Db } from "@gsc/db";
import type { GscClient, Sitemap as ApiSitemap, UrlInspectionResult } from "@gsc/gsc-client";
import type { InspectionRecord, Sitemap } from "./indexing.ts";
import type { IndexingRepo, InspectionBudget } from "./tools/indexing.ts";

const { properties, urlInspections, quotaCounters, factPage, dimPage } = schema;

/** Googles Property-Budget für die URL-Inspektion ([docs/04]): 2.000 pro Tag. */
const DEFAULT_DAILY_BUDGET = 2000;
/** Fenster für Traffic-basierte Kandidatenauswahl. */
const CANDIDATE_WINDOW_DAYS = 28;
/** Ab diesem Alter gilt eine Inspektion als veraltet. */
const STALE_DAYS = 30;
const SEARCH_TYPE = "web";
const QUOTA_KIND = "url_inspect";

/** Reiht URLs zur asynchronen Inspektion ein (Backend: pg-boss). Injiziert, damit der Adapter testbar bleibt. */
export interface InspectionQueue {
  enqueue(propertyId: number, urls: readonly string[]): Promise<void>;
}

export interface IndexingRepositoryDeps {
  readonly db: Db;
  readonly client: GscClient;
  readonly queue: InspectionQueue;
  /** Tagesbudget je Property; Vorgabe 2.000 ([docs/04]). */
  readonly dailyBudget?: number;
}

export class IndexingRepository implements IndexingRepo {
  readonly #db: Db;
  readonly #client: GscClient;
  readonly #queue: InspectionQueue;
  readonly #dailyBudget: number;

  constructor(deps: IndexingRepositoryDeps) {
    this.#db = deps.db;
    this.#client = deps.client;
    this.#queue = deps.queue;
    this.#dailyBudget = deps.dailyBudget ?? DEFAULT_DAILY_BUDGET;
  }

  async inspect(propertyId: number, url: string, forceRefresh: boolean): Promise<InspectionRecord> {
    if (!forceRefresh) {
      const cached = await this.#cached(propertyId, url);
      if (cached) return cached;
    }
    const { siteUrl, userId } = await this.#property(propertyId);
    const result = await this.#client.inspectUrl(siteUrl, url);
    await this.#storeInspection(propertyId, url, result);
    await this.#addQuota(userId, propertyId, 1); // Live-Inspektion verbraucht Budget sofort.
    return toRecord(url, result);
  }

  async bulkCandidates(propertyId: number, select: string): Promise<readonly string[]> {
    const limit = this.#dailyBudget;
    if (select === "stale") {
      const rows = await this.#db
        .select({ url: urlInspections.url })
        .from(urlInspections)
        .where(
          and(
            eq(urlInspections.propertyId, propertyId),
            sql`${urlInspections.inspectedAt} < now() - make_interval(days => ${STALE_DAYS})`,
          ),
        )
        .orderBy(urlInspections.inspectedAt)
        .limit(limit);
      return rows.map((r) => r.url);
    }

    if (select === "never_inspected") {
      const rows = await this.#db
        .select({ url: dimPage.url })
        .from(dimPage)
        .where(
          and(
            eq(dimPage.propertyId, propertyId),
            sql`not exists (select 1 from ${urlInspections} i
                 where i.property_id = ${dimPage.propertyId} and i.url = ${dimPage.url})`,
          ),
        )
        .orderBy(desc(dimPage.lastSeen), dimPage.url)
        .limit(limit);
      return rows.map((r) => r.url);
    }

    // Traffic-basiert: Anker ist der jüngste Tag mit Seitendaten.
    const anchor = await this.#pageAnchor(propertyId);
    if (!anchor) return [];
    const recentFrom = addDays(anchor, -(CANDIDATE_WINDOW_DAYS - 1));

    if (select === "losing_traffic") {
      const priorTo = addDays(recentFrom, -1);
      const priorFrom = addDays(priorTo, -(CANDIDATE_WINDOW_DAYS - 1));
      const recent = sql`coalesce(sum(${factPage.clicks}) filter (where ${factPage.day} between ${recentFrom} and ${anchor}), 0)`;
      const prior = sql`coalesce(sum(${factPage.clicks}) filter (where ${factPage.day} between ${priorFrom} and ${priorTo}), 0)`;
      const rows = await this.#db
        .select({ url: dimPage.url, delta: sql<number>`(${recent} - ${prior})::float8` })
        .from(factPage)
        .innerJoin(dimPage, and(eq(dimPage.id, factPage.pageId), eq(dimPage.propertyId, factPage.propertyId)))
        .where(
          and(
            eq(factPage.propertyId, propertyId),
            eq(factPage.searchType, SEARCH_TYPE),
            sql`${factPage.day} between ${priorFrom} and ${anchor}`,
          ),
        )
        .groupBy(dimPage.url)
        .having(sql`(${recent} - ${prior}) < 0`)
        .orderBy(sql`(${recent} - ${prior}) asc`)
        .limit(limit);
      return rows.map((r) => r.url);
    }

    // top_traffic (Vorgabe): meistgeklickte Seiten im Fenster.
    const rows = await this.#db
      .select({ url: dimPage.url, clicks: sql<number>`coalesce(sum(${factPage.clicks}), 0)::float8` })
      .from(factPage)
      .innerJoin(dimPage, and(eq(dimPage.id, factPage.pageId), eq(dimPage.propertyId, factPage.propertyId)))
      .where(
        and(
          eq(factPage.propertyId, propertyId),
          eq(factPage.searchType, SEARCH_TYPE),
          sql`${factPage.day} between ${recentFrom} and ${anchor}`,
        ),
      )
      .groupBy(dimPage.url)
      .orderBy(sql`sum(${factPage.clicks}) desc`)
      .limit(limit);
    return rows.map((r) => r.url);
  }

  async inspectionBudget(propertyId: number): Promise<InspectionBudget> {
    const { userId } = await this.#property(propertyId);
    const today = utcToday();
    const [row] = await this.#db
      .select({ used: quotaCounters.used })
      .from(quotaCounters)
      .where(
        and(
          eq(quotaCounters.userId, userId),
          eq(quotaCounters.kind, QUOTA_KIND),
          eq(quotaCounters.propertyId, propertyId),
          eq(quotaCounters.windowStart, today),
        ),
      )
      .limit(1);
    const used = row?.used ?? 0;
    return { remaining: Math.max(0, this.#dailyBudget - used), resetAt: nextUtcMidnight() };
  }

  async enqueueInspections(propertyId: number, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    await this.#queue.enqueue(propertyId, urls);
    // Reservierung: die eingereihten Inspektionen zählen sofort gegen das Tagesbudget.
    const { userId } = await this.#property(propertyId);
    await this.#addQuota(userId, propertyId, urls.length);
  }

  async listSitemaps(propertyId: number): Promise<readonly Sitemap[]> {
    const { siteUrl } = await this.#property(propertyId);
    const raw = await this.#client.listSitemaps(siteUrl);
    return raw.map(toSitemap);
  }

  async submitSitemap(propertyId: number, sitemapUrl: string): Promise<void> {
    const { siteUrl } = await this.#property(propertyId);
    await this.#client.submitSitemap(siteUrl, sitemapUrl);
  }

  async inspectionRecords(propertyId: number): Promise<readonly InspectionRecord[]> {
    const rows = await this.#db
      .select({
        url: urlInspections.url,
        verdict: urlInspections.verdict,
        coverageState: urlInspections.coverageState,
        indexingState: urlInspections.indexingState,
        lastCrawl: sql<string | null>`${urlInspections.lastCrawl}::text`,
      })
      .from(urlInspections)
      .where(eq(urlInspections.propertyId, propertyId))
      .orderBy(desc(urlInspections.inspectedAt));
    return rows.map((r) => record(r.url, r.verdict, r.coverageState, r.indexingState, r.lastCrawl));
  }

  /* ── private Helfer ──────────────────────────────────────────────────────── */

  async #property(propertyId: number): Promise<{ siteUrl: string; userId: number }> {
    const [row] = await this.#db
      .select({ siteUrl: properties.siteUrl, userId: properties.userId })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    if (!row) throw new Error(`Unbekannte Property ${propertyId}`);
    return row;
  }

  async #cached(propertyId: number, url: string): Promise<InspectionRecord | undefined> {
    const [row] = await this.#db
      .select({
        verdict: urlInspections.verdict,
        coverageState: urlInspections.coverageState,
        indexingState: urlInspections.indexingState,
        lastCrawl: sql<string | null>`${urlInspections.lastCrawl}::text`,
      })
      .from(urlInspections)
      .where(and(eq(urlInspections.propertyId, propertyId), eq(urlInspections.url, url)))
      .limit(1);
    if (!row) return undefined;
    return record(url, row.verdict, row.coverageState, row.indexingState, row.lastCrawl);
  }

  async #storeInspection(propertyId: number, url: string, result: UrlInspectionResult): Promise<void> {
    const s = result.indexStatusResult ?? {};
    const fields = {
      inspectedAt: new Date(),
      verdict: s.verdict ?? null,
      coverageState: s.coverageState ?? null,
      indexingState: s.indexingState ?? null,
      robotsState: s.robotsTxtState ?? null,
      pageFetchState: s.pageFetchState ?? null,
      lastCrawl: s.lastCrawlTime ? new Date(s.lastCrawlTime) : null,
      canonicalGoogle: s.googleCanonical ?? null,
      canonicalUser: s.userCanonical ?? null,
      details: result as unknown,
    };
    await this.#db
      .insert(urlInspections)
      .values({ propertyId, url, ...fields })
      .onConflictDoUpdate({ target: [urlInspections.propertyId, urlInspections.url], set: fields });
  }

  async #addQuota(userId: number, propertyId: number, n: number): Promise<void> {
    await this.#db
      .insert(quotaCounters)
      .values({ userId, kind: QUOTA_KIND, propertyId, windowStart: utcToday(), used: n })
      .onConflictDoUpdate({
        target: [quotaCounters.userId, quotaCounters.kind, quotaCounters.propertyId, quotaCounters.windowStart],
        set: { used: sql`${quotaCounters.used} + ${n}` },
      });
  }

  async #pageAnchor(propertyId: number): Promise<string | null> {
    const [row] = await this.#db
      .select({ day: sql<string | null>`max(${factPage.day})::text` })
      .from(factPage)
      .where(and(eq(factPage.propertyId, propertyId), eq(factPage.searchType, SEARCH_TYPE)));
    return row?.day ?? null;
  }
}

/* ── modulweite Helfer ─────────────────────────────────────────────────────── */

/** Baut einen InspectionRecord und lässt fehlende Felder weg (exactOptionalPropertyTypes). */
function record(
  url: string,
  verdict: string | null,
  coverageState: string | null,
  indexingState: string | null,
  lastCrawl: string | null,
): InspectionRecord {
  return {
    url,
    ...(verdict != null ? { verdict } : {}),
    ...(coverageState != null ? { coverageState } : {}),
    ...(indexingState != null ? { indexingState } : {}),
    ...(lastCrawl != null ? { lastCrawl } : {}),
  };
}

function toRecord(url: string, result: UrlInspectionResult): InspectionRecord {
  const s = result.indexStatusResult ?? {};
  return record(url, s.verdict ?? null, s.coverageState ?? null, s.indexingState ?? null, s.lastCrawlTime ?? null);
}

function toSitemap(s: ApiSitemap): Sitemap {
  return {
    path: s.path,
    isPending: s.isPending ?? false,
    isIndex: s.isSitemapsIndex ?? false,
    warnings: toCount(s.warnings),
    errors: toCount(s.errors),
  };
}

/** Google liefert warnings/errors als Zeichenkette; hier zu einer Zahl normalisiert. */
function toCount(v?: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
