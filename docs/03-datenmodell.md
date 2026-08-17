# 03 — Datenmodell

PostgreSQL 17, zwei Schemas: **`core`** für die Control Plane (Nutzer, Abos, Zustand — klein, transaktional) und **`wh`** für das Warehouse (Fakten — groß, schreibintensiv, analytisch gelesen). Eine Instanz, ein Betriebsobjekt.

## Was sich gegenüber der SQLite-Fassung ändert

**Sharding entfällt ersatzlos.** Die Vorversion brauchte `properties.database_id`, eine `resolveDb()`-Indirektion, Shard-Provisionierung und Migrationsläufe über alle Shards, weil D1 bei 10 GB je Datenbank endet. An seine Stelle tritt deklarative Partitionierung nach Monat — dieselbe Wirkung für Abfragepläne und Wartung, aber Bordmittel statt Eigenbau.

**Die Zeilenobergrenzen sind nicht mehr unsere.** In der SQLite-Fassung war Top-N je Tag eine Speicherentscheidung: 5.000 / 25.000 / 50.000 Zeilen je nach Plan. Auf NVMe mit 512 GB ist das keine Frage mehr. Die einzig verbleibende Grenze ist Googles eigene — rund 50.000 Zeilen pro Tag und Suchtyp. **Wir holen künftig, was Google hergibt, für alle Pläne.** Der Sammelposten `__other__` steht damit nur noch für Googles Anonymisierung, nicht mehr für unsere Kürzung. Das vereinfacht die Erklärung gegenüber dem Nutzer erheblich und verlangt eine Anpassung der Plan-Matrix in [07-billing.md](07-billing.md).

**Die Analyse-Engine wird zu SQL.** `percentile_cont`, `regr_slope`, `stddev_samp`, Fensterfunktionen mit `RANGE BETWEEN INTERVAL` — was in der Vorversion in JavaScript nachgebaut werden musste, sind hier Bordmittel ([06-analyse-engine.md](06-analyse-engine.md)).

## Schlüsselstrategie

Fakten referenzieren **`bigint`-Surrogatschlüssel**, nicht die externen Kennungen. Eine Property-ULID als `text` wiegt 27 Byte pro Zeile; bei 9 Mio. Zeilen im Jahr sind das 170 MB, die nichts leisten. Nach außen — in URLs, Stripe-Metadaten, Tool-Antworten — wird `public_id` verwendet.

Alle Zeitpunkte sind `timestamptz`, alle Tagesangaben `date`. Positionen werden als **impressionsgewichtete Summe** gespeichert, nie als Durchschnitt; die CTR wird nie gespeichert, sondern immer berechnet. Der Grund steht bei `fact_totals`.

---

## Control Plane

```sql
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
```

### Sync-Zustand und Rate-Budget

```sql
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
```

`covered_from`/`covered_to` je Grain sind die Grundlage der Warehouse-oder-Live-Entscheidung aus [01-architektur.md](01-architektur.md) und speisen `get_sync_status`.

---

## Warehouse

### Wörterbücher

Query- und URL-Texte wiederholen sich täglich. Sie einmal zu speichern und in den Fakten nur eine `bigint`-Kennung zu führen, reduziert das Volumen um den Faktor drei bis fünf.

```sql
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
```

Der Trigram-Index auf `dim_query.text` ist kein Beiwerk: `search_performance` erlaubt `contains`-Filter, und ohne ihn wird daraus bei Millionen Queries ein sequenzieller Scan.

### Fakten

Alle Faktentabellen sind **nach Monat range-partitioniert**. Das Partitionierungsfeld gehört deshalb in jeden Primärschlüssel.

`position_sum` ist die impressionsgewichtete Summe (`position × impressions`), nicht der Durchschnitt. Nur so ergibt die Aggregation über Tage oder Segmente eine korrekte Durchschnittsposition — der Mittelwert von Mittelwerten wäre falsch. Ebenso wird die CTR nie gespeichert, sondern stets aus `clicks / impressions` berechnet, damit sie bei jeder Aggregationsstufe stimmt.

```sql
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
```

### Partitionsverwaltung

```sql
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
```

Ein monatlicher systemd-Timer ruft `ensure_month_partitions(now()::date + interval '2 months')` auf — zwei Monate Vorlauf, damit ein ausgefallener Lauf nicht sofort zu Schreibfehlern führt. Beim Backfill legt der Worker fehlende Vergangenheitspartitionen selbst an.

`pg_partman` wäre die ausgereiftere Alternative. Für sechs Tabellen mit einem einzigen Partitionierungsmuster ist die eigene Funktion überschaubarer und spart eine Extension.

### Indexierung und Sitemaps

```sql
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
```

`url_inspections` hält nur den jeweils letzten Stand je URL. Eine Historie der Indexierungszustände wäre wertvoll, kollidiert aber mit dem harten Limit von 2.000 Inspektionen pro Tag und Property — eine dichte Zeitreihe ist damit ohnehin unerreichbar. `inspected_at` steuert stattdessen die Neubewertung.

### Rollups

```sql
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
```

Nächtlich für die letzten zwei Monate neu berechnet. Sie bedienen alle Langzeitfragen und bleiben erhalten, wenn Tagesfakten später ins Kaltarchiv wandern — Mehrjahresvergleiche funktionieren dann weiter ohne Zugriff auf den Objektspeicher.

---

## Abstimmbarkeit

Das Warehouse holt, was Google liefert. Was Google **nicht** liefert — anonymisierte seltene Suchanfragen — wird als Sammelzeile mit `query_id = 0` geführt, damit gilt:

```sql
-- Muss für jeden Tag aufgehen: die Summe der Query-Zeilen (inkl. Sammelposten)
-- entspricht exakt den Gesamtwerten.
SELECT t.day,
       t.clicks                        AS totals_clicks,
       coalesce(sum(q.clicks), 0)      AS query_clicks,
       t.clicks - coalesce(sum(q.clicks), 0) AS drift
  FROM wh.fact_totals t
  LEFT JOIN wh.fact_query q
         ON q.property_id = t.property_id
        AND q.day         = t.day
        AND q.search_type = t.search_type
 WHERE t.property_id = $1
   AND t.day BETWEEN $2 AND $3
 GROUP BY t.day, t.clicks
HAVING t.clicks <> coalesce(sum(q.clicks), 0);
```

Liefert die Abfrage Zeilen, ist der Sync fehlerhaft — `drift` benennt die Richtung.

Diese Identität ist die wichtigste Eigenschaft des Modells. Ohne sie ergeben Segmentanteile („34 % des Traffics sind Non-Brand") stillschweigend falsche Werte, weil der fehlende Anteil im Nenner nicht auftaucht. Ein Integritätstest prüft sie nach jedem Sync-Lauf stichprobenartig.

Bei `sc-domain:aip.aero` ist dieser Anteil groß: Über 28 Tage entfallen 91,7 % der Klicks auf Suchanfragen außerhalb der Top 100. Jedes Tool mit Query-Bezug muss den nicht benannten Anteil deshalb ausweisen statt wegzurunden ([05-tools.md](05-tools.md)).

---

## Volumen

Gemessene Ausgangslage `sc-domain:aip.aero`, 20.07.–16.08.2026: 28.982 Klicks, 767.142 Impressionen, rund 26.800 Impressionen pro Tag. Die genaue Zahl verschiedener Suchanfragen pro Tag ist wegen des 100-Zeilen-Deckels des genutzten Fremdzugangs nicht messbar und **im ersten Backfill der Phase 2 zu erheben**; die Schätzung liegt bei 3.000 bis 8.000.

Hochrechnung für eine Property dieser Größe, ein Jahr, alle Grains:

| Tabelle | Zeilen/Jahr | mit Index |
|---|---|---|
| `fact_totals` | ~2.200 | vernachlässigbar |
| `fact_query` | ~2,9 Mio. | ~0,5 GB |
| `fact_page` | ~1,8 Mio. | ~0,3 GB |
| `fact_query_page` | ~5,5 Mio. | ~1,0 GB |
| `fact_geo_device` | ~0,4 Mio. | < 0,1 GB |
| Wörterbücher | ~0,5 Mio. | ~0,1 GB |
| **Summe** | | **≈ 2 GB pro Jahr** |

Bei einer sehr großen Property, die Googles Tagesobergrenze ausschöpft, sind es eher 6–8 GB pro Jahr.

Auf 512 GB NVMe, abzüglich Reserve für WAL und Vakuum, bleiben rund 350 GB nutzbar — also grob **150 Property-Jahre** normaler oder **45 Property-Jahre** sehr großer Properties. Das ist keine Grenze, die in absehbarer Zeit greift, und wenn doch, ist der nächste Schritt ein größerer Server, kein Umbau.

Zum Vergleich: In der D1-Fassung wäre bereits eine einzige große Property nach zwei Jahren am 10-GB-Limit gewesen und hätte einen eigenen Shard gebraucht.

---

## Massenschreiben

Der Backfill nutzt `COPY` in eine ungeloggte Staging-Tabelle und übernimmt von dort mit einem `INSERT … ON CONFLICT DO UPDATE`:

```sql
CREATE UNLOGGED TABLE wh.stage_query (LIKE wh.fact_query INCLUDING DEFAULTS);

-- COPY wh.stage_query FROM STDIN (FORMAT binary)

INSERT INTO wh.fact_query AS f
SELECT * FROM wh.stage_query
ON CONFLICT (property_id, day, search_type, query_id) DO UPDATE
SET clicks = excluded.clicks,
    impressions = excluded.impressions,
    position_sum = excluded.position_sum;

TRUNCATE wh.stage_query;
```

`COPY` ist um Größenordnungen schneller als Einzel-Inserts, und `UNLOGGED` spart beim Staging das WAL. Der Upsert bleibt nötig, weil der Delta-Sync dieselben Tage mehrfach holt — Google korrigiert Daten mehrere Tage nach.

---

## Migrationen

Drizzle-Migrationen unter `packages/db/migrations`, streng vorwärtsgerichtet, angewendet beim Start von `app`, bevor der Port geöffnet wird.

Ein Punkt verdient Aufmerksamkeit: **Indexänderungen auf partitionierten Faktentabellen sperren**, wenn sie naiv ausgeführt werden. Neue Indizes gehören mit `CREATE INDEX CONCURRENTLY` je Partition angelegt, nicht am Elternteil — sonst steht der Sync für die Dauer des Aufbaus. Das ist der einzige Ort im Datenmodell, an dem eine Routineänderung produktionswirksam schiefgehen kann, und deshalb gehört es in die Migrationsvorlage statt in eine Handanweisung.
