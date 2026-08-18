/**
 * Konkrete `WarehouseRepo`-Implementierung gegen PostgreSQL ([docs/03], [docs/10]).
 * Setzt die datenbankfreie Port-Schnittstelle aus `../warehouse.ts` mit Drizzle-Abfragen
 * um; die Tool-Handler in `apps/app` bleiben dadurch ohne rohes SQL.
 *
 * Grundregeln aus `docs/03`, die hier eingehalten werden:
 * - Der Sammelposten `query_id = 0` (Googles anonymisierte Anfragen) wird aus den
 *   Segmentzeilen ausgeschlossen und getrennt als `anonymized` ausgewiesen.
 * - Position ist stets impressionsgewichtet (`sum(position_sum)/sum(impressions)`),
 *   nie ein Mittel aus Mitteln; CTR wird nie gespeichert, immer gerechnet.
 * - Alle Aggregate werden auf `float8` gecastet und Datumswerte auf `text`, damit die
 *   Rückgaben unabhängig vom Treiber-Typparser stabil bleiben.
 */

import { and, eq, ne, gte, lte, asc, ilike, sql, type SQL } from "drizzle-orm";
import type { Fact } from "@gsc/core";
import type { SeriesPoint, CannibalInput, DecayInput } from "@gsc/analytics";
import type { Db } from "../client.ts";
import {
  factTotals,
  factQuery,
  factPage,
  factQueryPage,
  factGeoDevice,
  dimQuery,
  dimPage,
  syncState,
} from "../schema.ts";
import type {
  WarehouseRepo,
  PerfQuery,
  PerfResult,
  PerfRow,
  Period,
  Dimension,
  SegmentPair,
  DecayInputs,
  ExportDataset,
  ExportRow,
} from "../warehouse.ts";

/** Harte Obergrenze für gruppierte Lesevorgänge — schützt den Speicher, liegt weit über realen Grenzen. */
const MAX_GROUPED_ROWS = 1_000_000;
/** Monatsfenster für die Content-Decay-Trendreihe. */
const DECAY_MONTHS = 24;

const ZERO: Fact = { clicks: 0, impressions: 0, positionSum: 0 };

export class WarehouseRepository implements WarehouseRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async performance(q: PerfQuery): Promise<PerfResult> {
    const rows = await this.#grouped(q.propertyId, q.dimension, q.period, q.searchType, {
      sortBy: q.sortBy ?? "clicks",
      limit: q.limit,
      ...(q.queryContains === undefined ? {} : { queryContains: q.queryContains }),
    });
    const totals = await this.#sumFacts(factTotals, q.propertyId, q.period, q.searchType);

    let anonymizedImpressions = 0;
    let anonymized: Fact | undefined;
    if (q.dimension === "query") {
      anonymized = await this.#collector(q.propertyId, q.period, q.searchType);
      anonymizedImpressions = anonymized.impressions;
    }

    const covered = await this.#covered(q.propertyId, grainFor(q.dimension), q.searchType, q.period);
    return {
      rows,
      totals,
      anonymizedImpressions,
      ...(anonymized ? { anonymized } : {}),
      source: "warehouse",
      covered,
    };
  }

  async segmentPairs(
    propertyId: number,
    dimension: Dimension,
    a: Period,
    b: Period,
    searchType: string,
  ): Promise<readonly SegmentPair[]> {
    const [ra, rb] = await Promise.all([
      this.#grouped(propertyId, dimension, a, searchType, { sortBy: "clicks" }),
      this.#grouped(propertyId, dimension, b, searchType, { sortBy: "clicks" }),
    ]);
    const toMap = (rows: readonly PerfRow[]) =>
      new Map<string, Fact>(
        rows.map((r) => [r.key, { clicks: r.clicks, impressions: r.impressions, positionSum: r.positionSum }]),
      );
    const ma = toMap(ra);
    const mb = toMap(rb);
    const keys = new Set<string>([...ma.keys(), ...mb.keys()]);
    return [...keys].map((key) => ({ key, a: ma.get(key) ?? ZERO, b: mb.get(key) ?? ZERO }));
  }

  async timeseries(
    propertyId: number,
    period: Period,
    searchType: string,
  ): Promise<readonly SeriesPoint[]> {
    // fact_totals hält genau eine Zeile je Tag/Suchtyp — keine Aggregation nötig.
    const rows = await this.#db
      .select({
        date: sql<string>`${factTotals.day}::text`,
        clicks: sql<number>`${factTotals.clicks}::float8`,
      })
      .from(factTotals)
      .where(this.#dayRange(factTotals, propertyId, searchType, period))
      .orderBy(asc(factTotals.day));
    return rows.map((r) => ({ date: r.date, clicks: Number(r.clicks) }));
  }

  async cannibalizationRows(
    propertyId: number,
    period: Period,
    searchType: string,
  ): Promise<readonly CannibalInput[]> {
    const week = sql<string>`to_char(date_trunc('week', ${factQueryPage.day}), 'YYYY-MM-DD')`;
    const rows = await this.#db
      .select({
        query: dimQuery.text,
        url: dimPage.url,
        week,
        clicks: sql<number>`coalesce(sum(${factQueryPage.clicks}), 0)::float8`,
        impressions: sql<number>`coalesce(sum(${factQueryPage.impressions}), 0)::float8`,
        positionSum: sql<number>`coalesce(sum(${factQueryPage.positionSum}), 0)::float8`,
      })
      .from(factQueryPage)
      .innerJoin(
        dimQuery,
        and(eq(dimQuery.id, factQueryPage.queryId), eq(dimQuery.propertyId, factQueryPage.propertyId)),
      )
      .innerJoin(
        dimPage,
        and(eq(dimPage.id, factQueryPage.pageId), eq(dimPage.propertyId, factQueryPage.propertyId)),
      )
      .where(and(this.#dayRange(factQueryPage, propertyId, searchType, period), ne(factQueryPage.queryId, 0)))
      .groupBy(dimQuery.text, dimPage.url, week)
      .limit(MAX_GROUPED_ROWS);
    return rows.map((r) => ({
      query: r.query,
      url: r.url,
      week: r.week,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      positionSum: Number(r.positionSum),
    }));
  }

  async decayInputs(propertyId: number, searchType: string): Promise<DecayInputs> {
    // Anker = jüngster Tag mit Seitendaten; alle Fenster hängen daran.
    const [anchorRow] = await this.#db
      .select({ day: sql<string | null>`max(${factPage.day})::text` })
      .from(factPage)
      .where(and(eq(factPage.propertyId, propertyId), eq(factPage.searchType, searchType)));
    const anchor = anchorRow?.day ?? null;
    if (!anchor) return { pages: [], siteYoy: 0 };

    const recentFrom = addDays(anchor, -89);
    const priorTo = addYears(anchor, -1);
    const priorFrom = addYears(recentFrom, -1);
    const monthlyFrom = addMonthsToFirst(anchor, -(DECAY_MONTHS - 1));

    const [recent, prior, monthlyRows] = await Promise.all([
      this.#pageClicks(propertyId, searchType, { from: recentFrom, to: anchor }),
      this.#pageClicks(propertyId, searchType, { from: priorFrom, to: priorTo }),
      this.#db
        .select({
          url: dimPage.url,
          clicks: sql<number>`coalesce(sum(${factPage.clicks}), 0)::float8`,
        })
        .from(factPage)
        .innerJoin(
          dimPage,
          and(eq(dimPage.id, factPage.pageId), eq(dimPage.propertyId, factPage.propertyId)),
        )
        .where(
          and(
            eq(factPage.propertyId, propertyId),
            eq(factPage.searchType, searchType),
            gte(factPage.day, monthlyFrom),
          ),
        )
        .groupBy(dimPage.url, sql`date_trunc('month', ${factPage.day})`)
        .orderBy(dimPage.url, sql`date_trunc('month', ${factPage.day})`),
    ]);

    const monthly = new Map<string, number[]>();
    for (const r of monthlyRows) {
      const arr = monthly.get(r.url) ?? [];
      arr.push(Number(r.clicks));
      monthly.set(r.url, arr);
    }

    const keys = new Set<string>([...recent.keys(), ...prior.keys()]);
    const pages: DecayInput[] = [...keys].map((key) => ({
      key,
      recentClicks: recent.get(key) ?? 0,
      priorYearClicks: prior.get(key) ?? 0,
      monthly: monthly.get(key) ?? [],
    }));

    const siteRecent = (await this.#sumFacts(factTotals, propertyId, { from: recentFrom, to: anchor }, searchType)).clicks;
    const sitePrior = (await this.#sumFacts(factTotals, propertyId, { from: priorFrom, to: priorTo }, searchType)).clicks;
    const siteYoy = sitePrior === 0 ? 0 : (siteRecent - sitePrior) / sitePrior;

    return { pages, siteYoy };
  }

  async exportDataset(
    propertyId: number,
    dataset: ExportDataset,
    period: Period,
  ): Promise<readonly ExportRow[]> {
    switch (dataset) {
      case "totals":
        return this.#exportTotals(propertyId, period);
      case "query":
        return this.#exportQuery(propertyId, period);
      case "page":
        return this.#exportPage(propertyId, period);
      case "query_page":
        return this.#exportQueryPage(propertyId, period);
    }
  }

  /* ── private Helfer ──────────────────────────────────────────────────────── */

  /** Gruppiert eine Dimension über einen Zeitraum; sortiert und deckelt optional. */
  async #grouped(
    propertyId: number,
    dimension: Dimension,
    period: Period,
    searchType: string,
    opts: { sortBy?: "clicks" | "impressions" | "position"; limit?: number; queryContains?: string } = {},
  ): Promise<PerfRow[]> {
    const limit = opts.limit ?? MAX_GROUPED_ROWS;
    const sortBy = opts.sortBy ?? "clicks";

    if (dimension === "query") {
      const order = orderExpr(sortBy, factQuery);
      const filter = opts.queryContains
        ? ilike(dimQuery.text, `%${likeEscape(opts.queryContains)}%`)
        : undefined;
      const rows = await this.#db
        .select({
          key: dimQuery.text,
          clicks: sql<number>`coalesce(sum(${factQuery.clicks}), 0)::float8`,
          impressions: sql<number>`coalesce(sum(${factQuery.impressions}), 0)::float8`,
          positionSum: sql<number>`coalesce(sum(${factQuery.positionSum}), 0)::float8`,
        })
        .from(factQuery)
        .innerJoin(
          dimQuery,
          and(eq(dimQuery.id, factQuery.queryId), eq(dimQuery.propertyId, factQuery.propertyId)),
        )
        .where(and(this.#dayRange(factQuery, propertyId, searchType, period), ne(factQuery.queryId, 0), filter))
        .groupBy(dimQuery.text)
        .orderBy(order)
        .limit(limit);
      return rows.map(toPerfRow);
    }

    if (dimension === "page") {
      const order = orderExpr(sortBy, factPage);
      const rows = await this.#db
        .select({
          key: dimPage.url,
          clicks: sql<number>`coalesce(sum(${factPage.clicks}), 0)::float8`,
          impressions: sql<number>`coalesce(sum(${factPage.impressions}), 0)::float8`,
          positionSum: sql<number>`coalesce(sum(${factPage.positionSum}), 0)::float8`,
        })
        .from(factPage)
        .innerJoin(
          dimPage,
          and(eq(dimPage.id, factPage.pageId), eq(dimPage.propertyId, factPage.propertyId)),
        )
        .where(this.#dayRange(factPage, propertyId, searchType, period))
        .groupBy(dimPage.url)
        .orderBy(order)
        .limit(limit);
      return rows.map(toPerfRow);
    }

    // country | device — beide aus fact_geo_device, nur der Schlüssel unterscheidet sich.
    const keyCol = dimension === "country" ? factGeoDevice.country : factGeoDevice.device;
    const order = orderExpr(sortBy, factGeoDevice);
    const rows = await this.#db
      .select({
        key: keyCol,
        clicks: sql<number>`coalesce(sum(${factGeoDevice.clicks}), 0)::float8`,
        impressions: sql<number>`coalesce(sum(${factGeoDevice.impressions}), 0)::float8`,
        positionSum: sql<number>`coalesce(sum(${factGeoDevice.positionSum}), 0)::float8`,
      })
      .from(factGeoDevice)
      .where(this.#dayRange(factGeoDevice, propertyId, searchType, period))
      .groupBy(keyCol)
      .orderBy(order)
      .limit(limit);
    return rows.map(toPerfRow);
  }

  /** Impressionsgewichtete Summe einer Faktentabelle mit `day`/`search_type`. */
  async #sumFacts(
    table: typeof factTotals,
    propertyId: number,
    period: Period,
    searchType: string,
  ): Promise<Fact> {
    const [r] = await this.#db
      .select({
        clicks: sql<number>`coalesce(sum(${table.clicks}), 0)::float8`,
        impressions: sql<number>`coalesce(sum(${table.impressions}), 0)::float8`,
        positionSum: sql<number>`coalesce(sum(${table.positionSum}), 0)::float8`,
      })
      .from(table)
      .where(this.#dayRange(table, propertyId, searchType, period));
    return {
      clicks: Number(r?.clicks ?? 0),
      impressions: Number(r?.impressions ?? 0),
      positionSum: Number(r?.positionSum ?? 0),
    };
  }

  /** Sammelposten der anonymisierten Anfragen (`query_id = 0`) als vollständiger Fakt. */
  async #collector(propertyId: number, period: Period, searchType: string): Promise<Fact> {
    const [r] = await this.#db
      .select({
        clicks: sql<number>`coalesce(sum(${factQuery.clicks}), 0)::float8`,
        impressions: sql<number>`coalesce(sum(${factQuery.impressions}), 0)::float8`,
        positionSum: sql<number>`coalesce(sum(${factQuery.positionSum}), 0)::float8`,
      })
      .from(factQuery)
      .where(and(this.#dayRange(factQuery, propertyId, searchType, period), eq(factQuery.queryId, 0)));
    return {
      clicks: Number(r?.clicks ?? 0),
      impressions: Number(r?.impressions ?? 0),
      positionSum: Number(r?.positionSum ?? 0),
    };
  }

  /** Klicks je Seiten-URL in einem Zeitraum (für den Decay-YoY). */
  async #pageClicks(propertyId: number, searchType: string, period: Period): Promise<Map<string, number>> {
    const rows = await this.#db
      .select({
        url: dimPage.url,
        clicks: sql<number>`coalesce(sum(${factPage.clicks}), 0)::float8`,
      })
      .from(factPage)
      .innerJoin(dimPage, and(eq(dimPage.id, factPage.pageId), eq(dimPage.propertyId, factPage.propertyId)))
      .where(this.#dayRange(factPage, propertyId, searchType, period))
      .groupBy(dimPage.url)
      .limit(MAX_GROUPED_ROWS);
    return new Map(rows.map((r) => [r.url, Number(r.clicks)]));
  }

  /** Deckt den angefragten Zeitraum mit der tatsächlichen Sync-Abdeckung ab (ehrliches `covered`). */
  async #covered(
    propertyId: number,
    grain: string,
    searchType: string,
    requested: Period,
  ): Promise<Period> {
    const [r] = await this.#db
      .select({
        from: sql<string | null>`${syncState.coveredFrom}::text`,
        to: sql<string | null>`${syncState.coveredTo}::text`,
      })
      .from(syncState)
      .where(
        and(
          eq(syncState.propertyId, propertyId),
          eq(syncState.grain, grain),
          eq(syncState.searchType, searchType),
        ),
      )
      .limit(1);
    if (!r || !r.from || !r.to) return requested;
    return {
      from: r.from > requested.from ? r.from : requested.from,
      to: r.to < requested.to ? r.to : requested.to,
    };
  }

  #dayRange(
    table: typeof factTotals | typeof factQuery | typeof factPage | typeof factQueryPage | typeof factGeoDevice,
    propertyId: number,
    searchType: string,
    period: Period,
  ): SQL {
    return and(
      eq(table.propertyId, propertyId),
      eq(table.searchType, searchType),
      gte(table.day, period.from),
      lte(table.day, period.to),
    )!;
  }

  async #exportTotals(propertyId: number, period: Period): Promise<ExportRow[]> {
    const rows = await this.#db
      .select({
        day: sql<string>`${factTotals.day}::text`,
        search_type: factTotals.searchType,
        clicks: sql<number>`${factTotals.clicks}::float8`,
        impressions: sql<number>`${factTotals.impressions}::float8`,
        position: positionExpr(factTotals),
        ctr: ctrExpr(factTotals),
      })
      .from(factTotals)
      .where(
        and(
          eq(factTotals.propertyId, propertyId),
          gte(factTotals.day, period.from),
          lte(factTotals.day, period.to),
        ),
      )
      .orderBy(asc(factTotals.day), asc(factTotals.searchType))
      .limit(MAX_GROUPED_ROWS);
    return rows.map((r) => ({
      day: r.day,
      search_type: r.search_type,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      position: numOrNull(r.position),
      ctr: numOrNull(r.ctr),
    }));
  }

  async #exportQuery(propertyId: number, period: Period): Promise<ExportRow[]> {
    // LEFT JOIN + Label: der Sammelposten (query_id = 0) bleibt erhalten, damit
    // SUM(fact_query) = fact_totals auch im Export gilt.
    const rows = await this.#db
      .select({
        day: sql<string>`${factQuery.day}::text`,
        search_type: factQuery.searchType,
        query: sql<string>`coalesce(${dimQuery.text}, '(anonymisiert)')`,
        clicks: sql<number>`${factQuery.clicks}::float8`,
        impressions: sql<number>`${factQuery.impressions}::float8`,
        position: positionExpr(factQuery),
        ctr: ctrExpr(factQuery),
      })
      .from(factQuery)
      .leftJoin(dimQuery, and(eq(dimQuery.id, factQuery.queryId), eq(dimQuery.propertyId, factQuery.propertyId)))
      .where(
        and(
          eq(factQuery.propertyId, propertyId),
          gte(factQuery.day, period.from),
          lte(factQuery.day, period.to),
        ),
      )
      .orderBy(asc(factQuery.day))
      .limit(MAX_GROUPED_ROWS);
    return rows.map((r) => ({
      day: r.day,
      search_type: r.search_type,
      query: r.query,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      position: numOrNull(r.position),
      ctr: numOrNull(r.ctr),
    }));
  }

  async #exportPage(propertyId: number, period: Period): Promise<ExportRow[]> {
    const rows = await this.#db
      .select({
        day: sql<string>`${factPage.day}::text`,
        search_type: factPage.searchType,
        page: dimPage.url,
        clicks: sql<number>`${factPage.clicks}::float8`,
        impressions: sql<number>`${factPage.impressions}::float8`,
        position: positionExpr(factPage),
        ctr: ctrExpr(factPage),
      })
      .from(factPage)
      .innerJoin(dimPage, and(eq(dimPage.id, factPage.pageId), eq(dimPage.propertyId, factPage.propertyId)))
      .where(
        and(eq(factPage.propertyId, propertyId), gte(factPage.day, period.from), lte(factPage.day, period.to)),
      )
      .orderBy(asc(factPage.day))
      .limit(MAX_GROUPED_ROWS);
    return rows.map((r) => ({
      day: r.day,
      search_type: r.search_type,
      page: r.page,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      position: numOrNull(r.position),
      ctr: numOrNull(r.ctr),
    }));
  }

  async #exportQueryPage(propertyId: number, period: Period): Promise<ExportRow[]> {
    const rows = await this.#db
      .select({
        day: sql<string>`${factQueryPage.day}::text`,
        search_type: factQueryPage.searchType,
        query: dimQuery.text,
        page: dimPage.url,
        clicks: sql<number>`${factQueryPage.clicks}::float8`,
        impressions: sql<number>`${factQueryPage.impressions}::float8`,
        position: positionExpr(factQueryPage),
        ctr: ctrExpr(factQueryPage),
      })
      .from(factQueryPage)
      .innerJoin(
        dimQuery,
        and(eq(dimQuery.id, factQueryPage.queryId), eq(dimQuery.propertyId, factQueryPage.propertyId)),
      )
      .innerJoin(
        dimPage,
        and(eq(dimPage.id, factQueryPage.pageId), eq(dimPage.propertyId, factQueryPage.propertyId)),
      )
      .where(
        and(
          eq(factQueryPage.propertyId, propertyId),
          gte(factQueryPage.day, period.from),
          lte(factQueryPage.day, period.to),
        ),
      )
      .orderBy(asc(factQueryPage.day))
      .limit(MAX_GROUPED_ROWS);
    return rows.map((r) => ({
      day: r.day,
      search_type: r.search_type,
      query: r.query,
      page: r.page,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      position: numOrNull(r.position),
      ctr: numOrNull(r.ctr),
    }));
  }
}

/* ── modulweite Helfer ─────────────────────────────────────────────────────── */

type FactTable =
  | typeof factTotals
  | typeof factQuery
  | typeof factPage
  | typeof factQueryPage
  | typeof factGeoDevice;

/** Sortierausdruck: Position ist impressionsgewichtet und aufsteigend (kleiner = besser). */
function orderExpr(sortBy: "clicks" | "impressions" | "position", t: FactTable): SQL {
  if (sortBy === "impressions") return sql`sum(${t.impressions}) desc`;
  if (sortBy === "position") return sql`sum(${t.positionSum}) / nullif(sum(${t.impressions}), 0) asc nulls last`;
  return sql`sum(${t.clicks}) desc`;
}

/** Impressionsgewichtete Durchschnittsposition je Zeile, auf zwei Stellen gerundet. */
function positionExpr(t: FactTable): SQL<number | null> {
  return sql<number | null>`round((${t.positionSum} / nullif(${t.impressions}, 0))::numeric, 2)::float8`;
}

/** CTR je Zeile (nie gespeichert, immer gerechnet), auf vier Stellen gerundet. */
function ctrExpr(t: FactTable): SQL<number | null> {
  return sql<number | null>`round((${t.clicks}::numeric / nullif(${t.impressions}, 0)), 4)::float8`;
}

function toPerfRow(r: { key: string; clicks: number; impressions: number; positionSum: number }): PerfRow {
  return {
    key: r.key,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    positionSum: Number(r.positionSum),
  };
}

function numOrNull(v: number | null): number | null {
  return v === null ? null : Number(v);
}

/** Grain für die Sync-Abdeckung je Dimension ([docs/03]). */
function grainFor(d: Dimension): string {
  return d === "query" ? "query" : d === "page" ? "page" : "geo_device";
}

/** ILIKE-Sonderzeichen maskieren (Backslash ist der Default-Escape in PostgreSQL). */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function isoToUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(iso: string, days: number): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const d = isoToUtc(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Monatserster des um `months` verschobenen Monats (für das Decay-Trendfenster). */
function addMonthsToFirst(iso: string, months: number): string {
  const d = isoToUtc(iso);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
