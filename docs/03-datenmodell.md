# 03 — Datenmodell

Zwei logisch getrennte Bereiche: die **Control Plane** (Nutzer, Abos, Zustand — klein, transaktional) und das **Warehouse** (Fakten — groß, schreibintensiv, analytisch gelesen). Physisch starten beide in einer D1, sind aber so geschnitten, dass das Warehouse je Property in eine eigene Datenbank ausgelagert werden kann, ohne Handler-Code zu ändern.

Alle Zeitstempel sind UTC-Sekunden (`INTEGER`), alle Datumsangaben `TEXT` im Format `YYYY-MM-DD` — sortierbar, in SQLite indizierbar und ohne Zeitzonenfallen.

---

## Control Plane

```sql
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,           -- ULID
  google_sub         TEXT NOT NULL UNIQUE,       -- stabile Google-Identität, nicht die E-Mail
  email              TEXT NOT NULL,
  locale             TEXT NOT NULL DEFAULT 'de',
  stripe_customer_id TEXT,
  created_at         INTEGER NOT NULL,
  deleted_at         INTEGER
);
CREATE INDEX idx_users_stripe ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE google_credentials (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_enc  BLOB NOT NULL,              -- AES-GCM: version || iv || ciphertext
  key_version        INTEGER NOT NULL DEFAULT 1, -- ermöglicht Schlüsselrotation
  scopes             TEXT NOT NULL,              -- space-separated, wie von Google zurückgegeben
  granted_at         INTEGER NOT NULL,
  last_refresh_at    INTEGER,
  revoked_at         INTEGER
);

CREATE TABLE properties (
  id             TEXT PRIMARY KEY,               -- ULID
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_url       TEXT NOT NULL,                  -- 'sc-domain:aip.aero' oder 'https://example.com/'
  type           TEXT NOT NULL CHECK (type IN ('domain','url_prefix')),
  permission_level TEXT NOT NULL,                -- siteOwner | siteFullUser | siteRestrictedUser | siteUnverifiedUser
  sync_enabled   INTEGER NOT NULL DEFAULT 0,
  sync_grains    TEXT NOT NULL DEFAULT '[]',     -- JSON-Array aktiver Grains, planabhängig
  brand_pattern  TEXT,                           -- Regex für Brand/Non-Brand-Segmentierung
  database_id    TEXT,                           -- NULL = geteilte Warehouse-D1; sonst eigener Shard
  backfill_from  TEXT,                           -- frühestes Datum mit eigenen Daten
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  UNIQUE (user_id, site_url)
);
CREATE INDEX idx_properties_user ON properties(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_properties_sync ON properties(sync_enabled) WHERE sync_enabled = 1;

CREATE TABLE subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  plan                   TEXT NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free','starter','pro','agency')),
  status                 TEXT NOT NULL DEFAULT 'active',  -- Stripe-Status, 1:1 gespiegelt
  current_period_end     INTEGER,
  trial_end              INTEGER,
  cancel_at              INTEGER,
  updated_at             INTEGER NOT NULL
);

CREATE TABLE quota_counters (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,          -- 'url_inspect', 'export', 'live_query', ...
  scope_id     TEXT NOT NULL DEFAULT '',  -- optional property_id bei Pro-Property-Limits
  window_start TEXT NOT NULL,          -- 'YYYY-MM-DD' oder 'YYYY-MM'
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key, scope_id, window_start)
);

CREATE TABLE usage_events (             -- Rohdaten für Abrechnung und Produktanalytik
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  tool       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  units      INTEGER NOT NULL DEFAULT 1,
  billable   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_usage_user_ts ON usage_events(user_id, ts);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  property_id  TEXT,
  tool         TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  params_hash  TEXT NOT NULL,          -- SHA-256 der Parameter, keine Klartext-Queries
  source       TEXT NOT NULL,          -- 'warehouse' | 'live' | 'mixed'
  rows_out     INTEGER,
  duration_ms  INTEGER,
  error_code   TEXT
);
CREATE INDEX idx_audit_user_ts ON audit_log(user_id, ts);
```

**Zum Sync-Zustand:**

```sql
CREATE TABLE sync_state (
  property_id  TEXT NOT NULL,
  grain        TEXT NOT NULL,          -- 'totals','query','page','query_page','geo_device','appearance','hourly'
  search_type  TEXT NOT NULL,          -- 'web','image','video','news','discover','googleNews'
  covered_from TEXT,                   -- erstes vollständig synchronisiertes Datum
  covered_to   TEXT,                   -- letztes vollständig synchronisiertes Datum
  last_run_at  INTEGER,
  PRIMARY KEY (property_id, grain, search_type)
);

CREATE TABLE sync_jobs (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  grain       TEXT NOT NULL,
  search_type TEXT NOT NULL,
  date_from   TEXT NOT NULL,
  date_to     TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 100,   -- niedriger = wichtiger; Backfill 200, Delta 50
  status      TEXT NOT NULL DEFAULT 'pending' -- pending|running|done|failed|skipped
                CHECK (status IN ('pending','running','done','failed','skipped')),
  start_row   INTEGER NOT NULL DEFAULT 0,     -- Pagination-Cursor, überlebt Abbrüche
  rows_written INTEGER NOT NULL DEFAULT 0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_jobs_queue ON sync_jobs(status, priority, created_at);
CREATE INDEX idx_jobs_property ON sync_jobs(property_id, status);
```

`covered_from`/`covered_to` je Grain sind die Grundlage der Warehouse-oder-Live-Entscheidung aus [01-architektur.md](01-architektur.md) und speisen `get_sync_status`.

---

## Warehouse

### Wörterbücher

Query- und URL-Texte wiederholen sich täglich. Sie einmal zu speichern und in den Fakten nur eine Integer-ID zu führen, reduziert das Volumen erheblich — bei einer typischen Property um den Faktor drei bis fünf.

Die Wörterbücher sind **pro Property**, nicht global. Das kostet etwas Redundanz zwischen Mandanten, ist aber die Voraussetzung dafür, eine Property später ohne Datenmigration in einen eigenen Shard zu verschieben.

```sql
CREATE TABLE dim_query (
  property_id TEXT NOT NULL,
  query_id    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  is_brand    INTEGER NOT NULL DEFAULT 0,   -- aus properties.brand_pattern abgeleitet
  word_count  INTEGER NOT NULL,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  PRIMARY KEY (property_id, query_id)
);
CREATE UNIQUE INDEX idx_dim_query_text ON dim_query(property_id, text);
CREATE INDEX idx_dim_query_brand ON dim_query(property_id, is_brand);

CREATE TABLE dim_page (
  property_id TEXT NOT NULL,
  page_id     INTEGER NOT NULL,
  url         TEXT NOT NULL,
  path        TEXT NOT NULL,                -- ohne Host, für Verzeichnis-Aggregationen
  depth       INTEGER NOT NULL,             -- Anzahl Pfadsegmente
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  PRIMARY KEY (property_id, page_id)
);
CREATE UNIQUE INDEX idx_dim_page_url ON dim_page(property_id, url);
CREATE INDEX idx_dim_page_path ON dim_page(property_id, path);
```

### Fakten

Alle Faktentabellen speichern `clicks`, `impressions` und `position_sum`. **`position` wird nicht als Durchschnitt gespeichert, sondern als impressionsgewichtete Summe** (`position × impressions`). Nur so lässt sich beim Aggregieren über Tage oder Segmente eine korrekte Durchschnittsposition berechnen — der Mittelwert von Mittelwerten wäre falsch. Die CTR wird nie gespeichert, sondern immer aus `clicks / impressions` berechnet.

```sql
-- Gesamtwerte: klein, vollständig, Bezugsgröße für jede Abstimmung
CREATE TABLE fact_totals (
  property_id  TEXT NOT NULL,
  date         TEXT NOT NULL,
  search_type  TEXT NOT NULL,
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, date, search_type)
);

CREATE TABLE fact_query (
  property_id  TEXT NOT NULL,
  date         TEXT NOT NULL,
  search_type  TEXT NOT NULL,
  query_id     INTEGER NOT NULL,        -- 0 = Sammelposten '__other__'
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, date, search_type, query_id)
);
CREATE INDEX idx_fq_query ON fact_query(property_id, query_id, date);
CREATE INDEX idx_fq_clicks ON fact_query(property_id, date, clicks DESC);

CREATE TABLE fact_page (
  property_id  TEXT NOT NULL,
  date         TEXT NOT NULL,
  search_type  TEXT NOT NULL,
  page_id      INTEGER NOT NULL,
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, date, search_type, page_id)
);
CREATE INDEX idx_fp_page ON fact_page(property_id, page_id, date);
CREATE INDEX idx_fp_clicks ON fact_page(property_id, date, clicks DESC);

-- Die teuerste Tabelle. Tagesgrain nur ab Pro, sonst Wochengrain (date = Montag der Woche).
CREATE TABLE fact_query_page (
  property_id  TEXT NOT NULL,
  date         TEXT NOT NULL,
  search_type  TEXT NOT NULL,
  query_id     INTEGER NOT NULL,
  page_id      INTEGER NOT NULL,
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, date, search_type, query_id, page_id)
);
CREATE INDEX idx_fqp_query ON fact_query_page(property_id, query_id, date);
CREATE INDEX idx_fqp_page  ON fact_query_page(property_id, page_id, date);

CREATE TABLE fact_geo_device (
  property_id  TEXT NOT NULL,
  date         TEXT NOT NULL,
  search_type  TEXT NOT NULL,
  country      TEXT NOT NULL,           -- ISO-3166-1 alpha-3, wie von Google geliefert
  device       TEXT NOT NULL,           -- DESKTOP | MOBILE | TABLET
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, date, search_type, country, device)
);

CREATE TABLE fact_appearance (
  property_id  TEXT NOT NULL,
  date         TEXT NOT NULL,
  search_type  TEXT NOT NULL,
  appearance   TEXT NOT NULL,           -- searchAppearance-Wert
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, date, search_type, appearance)
);

-- Rollierendes Fenster (~10 Tage). Werte sind ausdrücklich partiell.
CREATE TABLE fact_hourly (
  property_id  TEXT NOT NULL,
  ts_hour      INTEGER NOT NULL,        -- UTC-Stundenbeginn; Google liefert Pacific Time
  search_type  TEXT NOT NULL,
  clicks       INTEGER NOT NULL,
  impressions  INTEGER NOT NULL,
  position_sum REAL NOT NULL,
  PRIMARY KEY (property_id, ts_hour, search_type)
);
```

### Indexierung und Sitemaps

```sql
CREATE TABLE url_inspections (
  property_id      TEXT NOT NULL,
  url              TEXT NOT NULL,
  inspected_at     INTEGER NOT NULL,
  verdict          TEXT,               -- PASS | PARTIAL | FAIL | NEUTRAL
  coverage_state   TEXT,
  indexing_state   TEXT,
  robots_state     TEXT,
  page_fetch_state TEXT,
  last_crawl_time  INTEGER,
  canonical_google TEXT,
  canonical_user   TEXT,
  sitemaps_json    TEXT,
  referring_urls_json TEXT,
  rich_results_json   TEXT,
  mobile_usability_json TEXT,
  PRIMARY KEY (property_id, url)
);
CREATE INDEX idx_insp_verdict ON url_inspections(property_id, verdict);
CREATE INDEX idx_insp_age ON url_inspections(property_id, inspected_at);

CREATE TABLE sitemaps (
  property_id     TEXT NOT NULL,
  path            TEXT NOT NULL,
  type            TEXT,
  last_submitted  INTEGER,
  last_downloaded INTEGER,
  is_pending      INTEGER NOT NULL DEFAULT 0,
  is_sitemaps_index INTEGER NOT NULL DEFAULT 0,
  warnings        INTEGER NOT NULL DEFAULT 0,
  errors          INTEGER NOT NULL DEFAULT 0,
  contents_json   TEXT,
  fetched_at      INTEGER NOT NULL,
  PRIMARY KEY (property_id, path)
);
```

`url_inspections` hält nur den jeweils **letzten** Stand je URL. Eine Historie der Indexierungszustände wäre wertvoll, kollidiert aber mit dem harten Limit von 2.000 Inspektionen pro Tag und Property — eine dichte Zeitreihe ist damit ohnehin nicht erreichbar. `inspected_at` steuert stattdessen die Neubewertung: ältere Einträge werden bei Bedarf priorisiert aufgefrischt.

---

## Zeilenkontrolle und Abstimmbarkeit

Ein vollständiger Abzug aller Query-Zeilen wäre weder abrufbar (Googles Tagesobergrenze) noch speicherbar. Das Warehouse hält deshalb **Top-N je Tag und Dimension**, sortiert nach Impressionen:

| Plan | N (query) | N (page) | query_page |
|---|---|---|---|
| Starter | 5.000 | 5.000 | Wochengrain, 5.000 |
| Pro | 25.000 | 25.000 | Tagesgrain, 25.000 |
| Agency | 50.000 | 50.000 | Tagesgrain, 50.000 |

Was jenseits von N liegt, geht nicht verloren, sondern wird zu einer Sammelzeile mit `query_id = 0` verdichtet. Damit gilt:

```
SUM(fact_query WHERE date = d)  ==  fact_totals WHERE date = d
```

Diese Identität ist die wichtigste Eigenschaft des ganzen Modells. Ohne sie ergeben Segmentanteile („34 % des Traffics sind Non-Brand") stillschweigend falsche Werte, weil der abgeschnittene Longtail im Nenner fehlt. Ein Integritätstest prüft die Gleichung nach jedem Sync-Lauf stichprobenartig.

Unabhängig davon anonymisiert Google seltene Suchanfragen und liefert sie gar nicht erst aus. Die Differenz zwischen `fact_totals` und der Summe der benannten Queries ist deshalb immer positiv. Tools, die Anteile ausweisen, müssen diesen Anteil sichtbar machen, statt ihn wegzurunden — siehe [05-tools.md](05-tools.md).

## Rollups

```sql
CREATE TABLE rollup_query_month (
  property_id TEXT NOT NULL, month TEXT NOT NULL, search_type TEXT NOT NULL,
  query_id INTEGER NOT NULL,
  clicks INTEGER NOT NULL, impressions INTEGER NOT NULL, position_sum REAL NOT NULL,
  days_present INTEGER NOT NULL,     -- an wie vielen Tagen die Query überhaupt auftrat
  PRIMARY KEY (property_id, month, search_type, query_id)
);
-- rollup_page_month analog
```

Monats-Rollups werden nachts erzeugt und bedienen alle Langzeitfragen. Ab Phase 6 dürfen Tagesfakten, die älter als 24 Monate sind, nach R2 ausgelagert und aus D1 entfernt werden — die Rollups bleiben, sodass Mehrjahresvergleiche weiter ohne Zugriff aufs Kaltarchiv funktionieren.

## Volumenrechnung

Für eine mittelgroße Property auf dem Pro-Grain (N = 25.000):

| Tabelle | Zeilen/Jahr | geschätzt |
|---|---|---|
| `fact_totals` | ~2.200 | vernachlässigbar |
| `fact_query` | ~9,1 Mio. | 0,5–0,9 GB inkl. Index |
| `fact_page` | ~9,1 Mio. | 0,5–0,9 GB |
| `fact_query_page` | ~18 Mio. | 1,2–2,0 GB |
| `fact_geo_device` | ~0,5 Mio. | < 0,1 GB |
| Wörterbücher | ~1–3 Mio. | 0,1–0,3 GB |
| **Summe** | | **≈ 2,5–4 GB pro Jahr** |

Bei einem D1-Limit von 10 GB je Datenbank (Planungsannahme, vor Umsetzung zu prüfen) bedeutet das: Eine große Property auf vollem Grain erreicht nach etwa zwei bis drei Jahren den Shard-Punkt. Kleine Properties bleiben unbegrenzt in der geteilten Datenbank. Der Übergang ist in [01-architektur.md](01-architektur.md) beschrieben und wird durch einen Alarm auf die Datenbankgröße ausgelöst, nicht durch Zufallsentdeckung im Störungsfall.

### Rechenprobe an echten Daten

Gemessen an `sc-domain:aip.aero`, Zeitraum 20.07.–17.08.2026 (28 vollständige Tage):

| Kennzahl | Wert |
|---|---|
| Klicks gesamt | 28.982 (≈ 1.012/Tag) |
| Impressionen gesamt | 767.142 (≈ 26.824/Tag) |
| Anteil der Top-100-Queries an den Klicks | **8,3 %** |
| Anteil der Top-100-Queries an den Impressionen | **6,7 %** |

**91,7 % der Klicks dieser Property liegen außerhalb der 100 klickstärksten Suchanfragen.** Die stärkste Einzelquery (`aip germany`, 109 Klicks) trägt 0,4 % bei. Das ist eine extrem verteilte Longtail-Struktur — und die empirische Bestätigung des gesamten Warehouse-Ansatzes: Ein Werkzeug mit 100-Zeilen-Deckel zeigt bei dieser Property acht Prozent des Geschehens.

Bei etwa 27.000 Impressionen pro Tag und dieser Verteilung ist mit mehreren tausend verschiedenen Suchanfragen täglich zu rechnen. Zwei Folgerungen:

1. Die obige Volumenschätzung (N = 25.000) ist für eine Property dieser Größe eine **Obergrenze**, nicht der Regelfall — der tatsächliche Bedarf dürfte bei 3.000 bis 8.000 Zeilen pro Tag liegen und damit deutlich unter 1 GB pro Jahr.
2. **Der Starter-Grain von N = 5.000 könnte bereits bei dieser Property greifen.** Die genaue Zahl verschiedener Suchanfragen pro Tag ist mit dem aktuellen Zugang nicht messbar (100-Zeilen-Deckel des Free-Plans). Sie ist im ersten Backfill der Phase 2 zu erheben; fällt sie über 5.000, ist der Starter-Wert anzuheben oder die Kürzung im Plan ausdrücklich auszuweisen.

Beide Punkte fließen in die Plan-Grenzen aus [07-billing.md](07-billing.md) und in die Bedarfsbegründung des Google-Quotenantrags ein.

## Migrationen

Drizzle-Migrationen unter `packages/db/migrations`, streng vorwärtsgerichtet. Die Warehouse-Migrationen laufen je Shard, nicht nur gegen die Standarddatenbank — dieser Umstand ist ab dem ersten Shard eine echte Fehlerquelle und gehört deshalb in ein Migrationsskript, das über `properties.database_id` iteriert, statt in eine Handanweisung.
