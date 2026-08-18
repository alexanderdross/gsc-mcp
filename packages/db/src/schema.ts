/**
 * Drizzle-Modelle für typsicheren Zugriff auf das GSC-MCP-Warehouse.
 *
 * Die maßgebliche DDL liegt in `migrations/0001_init.sql` und wird von der CI
 * gegen ein echtes PostgreSQL validiert. Diese Datei bildet dieselben Tabellen
 * für getippte Abfragen ab — sie erzeugt kein Schema (Partitionierung wird per
 * Migration verwaltet, nicht von Drizzle), sondern beschreibt es für den Compiler.
 *
 * Bezeichner (snake_case) entsprechen exakt den Spalten der Migration; die
 * TypeScript-Namen sind camelCase.
 */

import {
  pgSchema,
  bigint,
  integer,
  smallint,
  text,
  boolean,
  date,
  timestamp,
  doublePrecision,
  jsonb,
  char,
  primaryKey,
} from "drizzle-orm/pg-core";
import { bytea } from "./types.ts";

export const core = pgSchema("core");
export const wh = pgSchema("wh");

/* ── Control Plane ─────────────────────────────────────────────────────────── */

export const users = core.table("users", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  publicId: text("public_id").notNull().unique(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  locale: text("locale").notNull().default("de"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const googleCredentials = core.table("google_credentials", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  refreshTokenEnc: bytea("refresh_token_enc").notNull(),
  keyVersion: smallint("key_version").notNull().default(1),
  scopes: text("scopes").array().notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const properties = core.table("properties", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  publicId: text("public_id").notNull().unique(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  siteUrl: text("site_url").notNull(),
  kind: text("kind").notNull(), // 'domain' | 'url_prefix'
  permission: text("permission").notNull(),
  syncEnabled: boolean("sync_enabled").notNull().default(false),
  syncGrains: text("sync_grains").array().notNull().default([]),
  brandPattern: text("brand_pattern"),
  backfillFrom: date("backfill_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const subscriptions = core.table("subscriptions", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  cancelAt: timestamp("cancel_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncState = core.table(
  "sync_state",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    grain: text("grain").notNull(),
    searchType: text("search_type").notNull(),
    coveredFrom: date("covered_from"),
    coveredTo: date("covered_to"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.grain, t.searchType] })],
);

export const quotaCounters = core.table(
  "quota_counters",
  {
    userId: bigint("user_id", { mode: "number" }).notNull(),
    kind: text("kind").notNull(), // 'url_inspect' | 'export' | 'live_query'
    propertyId: bigint("property_id", { mode: "number" }).notNull().default(0),
    windowStart: date("window_start").notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.propertyId, t.windowStart] })],
);

export const bqExports = core.table("bq_exports", {
  propertyId: bigint("property_id", { mode: "number" }).primaryKey(),
  gcpProject: text("gcp_project").notNull(),
  dataset: text("dataset").notNull(),
  location: text("location").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastDataDate: date("last_data_date"),
  lastIngestAt: timestamp("last_ingest_at", { withTimezone: true }),
  bytesScanned: bigint("bytes_scanned", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("pending"),
  lastError: text("last_error"),
});

/* ── Warehouse: Wörterbücher ───────────────────────────────────────────────── */

export const dimQuery = wh.table("dim_query", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  propertyId: bigint("property_id", { mode: "number" }).notNull(),
  text: text("text").notNull(),
  isBrand: boolean("is_brand").notNull().default(false),
  wordCount: smallint("word_count").notNull(),
  firstSeen: date("first_seen").notNull(),
  lastSeen: date("last_seen").notNull(),
});

export const dimPage = wh.table("dim_page", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  propertyId: bigint("property_id", { mode: "number" }).notNull(),
  url: text("url").notNull(),
  path: text("path").notNull(),
  depth: smallint("depth").notNull(),
  firstSeen: date("first_seen").notNull(),
  lastSeen: date("last_seen").notNull(),
});

/* ── Warehouse: Fakten (partitioniert; PK enthält day) ─────────────────────── */

export const factTotals = wh.table(
  "fact_totals",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    searchType: text("search_type").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.day, t.searchType] })],
);

export const factQuery = wh.table(
  "fact_query",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    searchType: text("search_type").notNull(),
    queryId: bigint("query_id", { mode: "number" }).notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.day, t.searchType, t.queryId] })],
);

export const factPage = wh.table(
  "fact_page",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    searchType: text("search_type").notNull(),
    pageId: bigint("page_id", { mode: "number" }).notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.day, t.searchType, t.pageId] })],
);

export const factQueryPage = wh.table(
  "fact_query_page",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    searchType: text("search_type").notNull(),
    queryId: bigint("query_id", { mode: "number" }).notNull(),
    pageId: bigint("page_id", { mode: "number" }).notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.day, t.searchType, t.queryId, t.pageId] }),
  ],
);

export const factGeoDevice = wh.table(
  "fact_geo_device",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    searchType: text("search_type").notNull(),
    country: char("country", { length: 3 }).notNull(),
    device: text("device").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.day, t.searchType, t.country, t.device] }),
  ],
);

export const factAppearance = wh.table(
  "fact_appearance",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    searchType: text("search_type").notNull(),
    appearance: text("appearance").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.day, t.searchType, t.appearance] })],
);

export const factHourly = wh.table(
  "fact_hourly",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    searchType: text("search_type").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    positionSum: doublePrecision("position_sum").notNull(),
    partial: boolean("partial").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.hour, t.searchType] })],
);

export const urlInspections = wh.table(
  "url_inspections",
  {
    propertyId: bigint("property_id", { mode: "number" }).notNull(),
    url: text("url").notNull(),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }).notNull(),
    verdict: text("verdict"),
    coverageState: text("coverage_state"),
    indexingState: text("indexing_state"),
    robotsState: text("robots_state"),
    pageFetchState: text("page_fetch_state"),
    lastCrawl: timestamp("last_crawl", { withTimezone: true }),
    canonicalGoogle: text("canonical_google"),
    canonicalUser: text("canonical_user"),
    details: jsonb("details"),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.url] })],
);
