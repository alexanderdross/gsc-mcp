-- 0001_init.sql — kanonisches Schema für GSC-MCP.
-- Erzeugt aus docs/03-datenmodell.md und dort dokumentiert.
-- Diese Datei ist die maßgebliche DDL-Quelle; die CI validiert sie
-- (scripts/validate-ddl.mjs) gegen ein echtes PostgreSQL.

CREATE SCHEMA core;
CREATE SCHEMA wh;

CREATE TABLE core.users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id          text        NOT NULL UNIQUE,      -- ULID, nach außen
  google_sub         text        NOT NULL UNIQUE,      -- stabile Identität, nicht die E-Mail
  email              text        NOT NULL,
  locale             text        NOT NULL DEFAULT 'de',
  stripe_customer_id text        UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE TABLE core.google_credentials (
  user_id           bigint      PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
  refresh_token_enc bytea       NOT NULL,              -- AES-256-GCM: iv || ciphertext || tag
  key_version       smallint    NOT NULL DEFAULT 1,    -- erlaubt Schlüsselrotation
  scopes            text[]      NOT NULL,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  last_refresh_at   timestamptz,
  revoked_at        timestamptz
);

CREATE TABLE core.properties (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     text        NOT NULL UNIQUE,
  user_id       bigint      NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  site_url      text        NOT NULL,                  -- 'sc-domain:aip.aero' | 'https://example.com/'
  kind          text        NOT NULL CHECK (kind IN ('domain','url_prefix')),
  permission    text        NOT NULL,                  -- siteOwner | siteFullUser | siteRestrictedUser
  sync_enabled  boolean     NOT NULL DEFAULT false,
  sync_grains   text[]      NOT NULL DEFAULT '{}',
  brand_pattern text,                                  -- Regex für Brand-/Non-Brand-Segmentierung
  backfill_from date,                                  -- frühestes Datum mit eigenen Daten
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (user_id, site_url)
);
CREATE INDEX ON core.properties (user_id) WHERE deleted_at IS NULL;
CREATE INDEX ON core.properties (sync_enabled) WHERE sync_enabled;

CREATE TABLE core.subscriptions (
  user_id                bigint      PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
  stripe_subscription_id text        UNIQUE,
  plan                   text        NOT NULL DEFAULT 'free'
                                       CHECK (plan IN ('free','starter','pro','agency')),
  status                 text        NOT NULL DEFAULT 'active',
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at              timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.quota_counters (
  user_id      bigint  NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  kind         text    NOT NULL,          -- 'url_inspect' | 'export' | 'live_query'
  property_id  bigint  NOT NULL DEFAULT 0,-- 0 = kontobezogen statt propertybezogen
  window_start date    NOT NULL,
  used         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, property_id, window_start)
);

CREATE TABLE core.usage_events (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  bigint      NOT NULL,
  tool     text        NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  units    integer     NOT NULL DEFAULT 1,
  billable boolean     NOT NULL DEFAULT false
);
CREATE INDEX ON core.usage_events (user_id, at DESC);

CREATE TABLE core.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint      NOT NULL,
  property_id bigint,
  tool        text        NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  params_hash text        NOT NULL,       -- SHA-256, niemals Klartext-Queries
  source      text        NOT NULL CHECK (source IN ('warehouse','live','mixed')),
  rows_out    integer,
  duration_ms integer,
  error_code  text
);
CREATE INDEX ON core.audit_log (user_id, at DESC);

-- Überlebt Neustarts, damit laufende MCP-Sitzungen ihren Property-Kontext behalten
CREATE TABLE core.mcp_sessions (
  session_id  text        PRIMARY KEY,     -- Mcp-Session-Id
  user_id     bigint      NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  property_id bigint      REFERENCES core.properties(id) ON DELETE SET NULL,
  prefs       jsonb       NOT NULL DEFAULT '{}',
  last_seen   timestamptz NOT NULL DEFAULT now()
);

-- Stripe stellt Events mehrfach zu; ein doppeltes checkout.session.completed
-- würde einen zweiten Backfill auslösen
CREATE TABLE core.processed_events (
  event_id     text        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.sync_state (
  property_id  bigint NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  grain        text   NOT NULL,   -- totals|query|page|query_page|geo_device|appearance|hourly
  search_type  text   NOT NULL,   -- web|image|video|news|discover|googleNews
  covered_from date,
  covered_to   date,
  last_run_at  timestamptz,
  PRIMARY KEY (property_id, grain, search_type)
);

-- pg-boss verwaltet die eigentliche Warteschlange in seinem eigenen Schema.
-- Diese Tabelle hält den fachlichen Zustand, den get_sync_status ausgibt.
CREATE TABLE core.sync_jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id  bigint      NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  grain        text        NOT NULL,
  search_type  text        NOT NULL,
  date_from    date        NOT NULL,
  date_to      date        NOT NULL,
  priority     smallint    NOT NULL DEFAULT 100,   -- niedriger = wichtiger
  status       text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','running','done','failed','skipped')),
  start_row    integer     NOT NULL DEFAULT 0,     -- Cursor, überlebt Abbrüche
  rows_written bigint      NOT NULL DEFAULT 0,
  attempts     smallint    NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON core.sync_jobs (status, priority, created_at);
CREATE INDEX ON core.sync_jobs (property_id, status);

-- Bulk Data Export je Property: liegt im BigQuery-Projekt des Kunden,
-- wir lesen mit unserem Dienstkonto ([12-wettbewerb-usp.md]).
CREATE TABLE core.bq_exports (
  property_id     bigint      PRIMARY KEY REFERENCES core.properties(id) ON DELETE CASCADE,
  gcp_project     text        NOT NULL,
  dataset         text        NOT NULL,
  location        text        NOT NULL,          -- 'EU', 'US', … — vom Kunden gewählt
  verified_at     timestamptz,                   -- letzte erfolgreiche Leseprüfung
  last_data_date  date,                          -- jüngste eingelesene Tagespartition
  last_ingest_at  timestamptz,
  bytes_scanned   bigint      NOT NULL DEFAULT 0,-- kumuliert, für Kostenkontrolle
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','degraded','revoked')),
  last_error      text
);
CREATE INDEX ON core.bq_exports (status) WHERE status <> 'active';

-- Token-Bucket. Ersetzt das Durable Object der Cloudflare-Fassung.
-- scope 'project' schützt die geteilte Google-Quote, 'property' die Site-Quote.
CREATE TABLE core.rate_budget (
  scope       text        NOT NULL CHECK (scope IN ('project','property')),
  scope_id    bigint      NOT NULL DEFAULT 0,
  tokens      double precision NOT NULL,
  rate_per_s  double precision NOT NULL,
  burst       double precision NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_id)
);

CREATE TABLE wh.dim_query (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  text        text   NOT NULL,
  is_brand    boolean NOT NULL DEFAULT false,
  word_count  smallint NOT NULL,
  first_seen  date   NOT NULL,
  last_seen   date   NOT NULL,
  UNIQUE (property_id, text)
);
CREATE INDEX ON wh.dim_query (property_id, is_brand);
-- Für Substring-Filter aus search_performance ohne Full Scan:
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ON wh.dim_query USING gin (text gin_trgm_ops);

CREATE TABLE wh.dim_page (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  url         text   NOT NULL,
  path        text   NOT NULL,     -- ohne Host, für Verzeichnis-Aggregationen
  depth       smallint NOT NULL,
  first_seen  date   NOT NULL,
  last_seen   date   NOT NULL,
  UNIQUE (property_id, url)
);
CREATE INDEX ON wh.dim_page (property_id, path text_pattern_ops);

-- Gesamtwerte: klein, vollständig, Bezugsgröße jeder Abstimmung
CREATE TABLE wh.fact_totals (
  property_id  bigint  NOT NULL,
  day          date    NOT NULL,
  search_type  text    NOT NULL,
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position_sum double precision NOT NULL,
  PRIMARY KEY (property_id, day, search_type)
) PARTITION BY RANGE (day);

CREATE TABLE wh.fact_query (
  property_id  bigint  NOT NULL,
  day          date    NOT NULL,
  search_type  text    NOT NULL,
  query_id     bigint  NOT NULL,   -- 0 = Sammelposten '__other__'
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position_sum double precision NOT NULL,
  PRIMARY KEY (property_id, day, search_type, query_id)
) PARTITION BY RANGE (day);
CREATE INDEX ON wh.fact_query (property_id, query_id, day);
CREATE INDEX ON wh.fact_query (property_id, day, clicks DESC);

CREATE TABLE wh.fact_page (
  property_id  bigint  NOT NULL,
  day          date    NOT NULL,
  search_type  text    NOT NULL,
  page_id      bigint  NOT NULL,
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position_sum double precision NOT NULL,
  PRIMARY KEY (property_id, day, search_type, page_id)
) PARTITION BY RANGE (day);
CREATE INDEX ON wh.fact_page (property_id, page_id, day);
CREATE INDEX ON wh.fact_page (property_id, day, clicks DESC);

-- Die größte Tabelle. Tagesgrain ab Pro, sonst Wochengrain (day = Montag).
CREATE TABLE wh.fact_query_page (
  property_id  bigint  NOT NULL,
  day          date    NOT NULL,
  search_type  text    NOT NULL,
  query_id     bigint  NOT NULL,
  page_id      bigint  NOT NULL,
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position_sum double precision NOT NULL,
  PRIMARY KEY (property_id, day, search_type, query_id, page_id)
) PARTITION BY RANGE (day);
CREATE INDEX ON wh.fact_query_page (property_id, query_id, day);
CREATE INDEX ON wh.fact_query_page (property_id, page_id, day);

CREATE TABLE wh.fact_geo_device (
  property_id  bigint  NOT NULL,
  day          date    NOT NULL,
  search_type  text    NOT NULL,
  country      char(3) NOT NULL,   -- ISO-3166-1 alpha-3, wie von Google geliefert
  device       text    NOT NULL CHECK (device IN ('DESKTOP','MOBILE','TABLET')),
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position_sum double precision NOT NULL,
  PRIMARY KEY (property_id, day, search_type, country, device)
) PARTITION BY RANGE (day);

CREATE TABLE wh.fact_appearance (
  property_id  bigint  NOT NULL,
  day          date    NOT NULL,
  search_type  text    NOT NULL,
  appearance   text    NOT NULL,
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position_sum double precision NOT NULL,
  PRIMARY KEY (property_id, day, search_type, appearance)
) PARTITION BY RANGE (day);

-- Rollierendes Fenster (~14 Tage), klein genug ohne Partitionierung.
-- Google liefert Pacific Time; hier normalisiert auf UTC.
CREATE TABLE wh.fact_hourly (
  property_id  bigint      NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  hour         timestamptz NOT NULL,
  search_type  text        NOT NULL,
  clicks       integer     NOT NULL,
  impressions  integer     NOT NULL,
  position_sum double precision NOT NULL,
  partial      boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (property_id, hour, search_type)
);

CREATE OR REPLACE FUNCTION wh.ensure_month_partitions(target date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  tbl   text;
  lo    date := date_trunc('month', target)::date;
  hi    date := (date_trunc('month', target) + interval '1 month')::date;
  part  text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fact_totals','fact_query','fact_page',
                             'fact_query_page','fact_geo_device','fact_appearance']
  LOOP
    part := format('%s_%s', tbl, to_char(lo, 'YYYYMM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS wh.%I PARTITION OF wh.%I FOR VALUES FROM (%L) TO (%L)',
      part, tbl, lo, hi);
  END LOOP;
END $$;

CREATE TABLE wh.url_inspections (
  property_id      bigint NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  url              text   NOT NULL,
  inspected_at     timestamptz NOT NULL,
  verdict          text,          -- PASS | PARTIAL | FAIL | NEUTRAL
  coverage_state   text,
  indexing_state   text,
  robots_state     text,
  page_fetch_state text,
  last_crawl       timestamptz,
  canonical_google text,
  canonical_user   text,
  details          jsonb,         -- Sitemaps, Referrer, Rich Results, Mobile Usability
  PRIMARY KEY (property_id, url)
);
CREATE INDEX ON wh.url_inspections (property_id, verdict);
CREATE INDEX ON wh.url_inspections (property_id, inspected_at);

CREATE TABLE wh.sitemaps (
  property_id     bigint NOT NULL REFERENCES core.properties(id) ON DELETE CASCADE,
  path            text   NOT NULL,
  kind            text,
  last_submitted  timestamptz,
  last_downloaded timestamptz,
  is_pending      boolean NOT NULL DEFAULT false,
  is_index        boolean NOT NULL DEFAULT false,
  warnings        integer NOT NULL DEFAULT 0,
  errors          integer NOT NULL DEFAULT 0,
  contents        jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, path)
);

CREATE TABLE wh.rollup_query_month (
  property_id  bigint  NOT NULL,
  month        date    NOT NULL,     -- Monatserster
  search_type  text    NOT NULL,
  query_id     bigint  NOT NULL,
  clicks       bigint  NOT NULL,
  impressions  bigint  NOT NULL,
  position_sum double precision NOT NULL,
  days_present smallint NOT NULL,    -- an wie vielen Tagen die Query auftrat
  PRIMARY KEY (property_id, month, search_type, query_id)
);
-- wh.rollup_page_month analog

CREATE UNLOGGED TABLE wh.stage_query (LIKE wh.fact_query INCLUDING DEFAULTS);

-- COPY wh.stage_query FROM STDIN (FORMAT binary)

INSERT INTO wh.fact_query AS f
SELECT * FROM wh.stage_query
ON CONFLICT (property_id, day, search_type, query_id) DO UPDATE
SET clicks = excluded.clicks,
    impressions = excluded.impressions,
    position_sum = excluded.position_sum;

TRUNCATE wh.stage_query;

