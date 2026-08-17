# 04 — Sync-Pipeline

## Die Grenzen, um die herum konstruiert wird

Öffentlich dokumentierte, harte Werte der Search Console API:

| Grenze | Wert |
|---|---|
| Historie | 16 Monate, danach unwiederbringlich gelöscht |
| Zeilen pro Request (`searchanalytics.query`) | 25.000 |
| Zeilen pro Tag und Suchtyp | ~50.000 (nach Klicks sortiert) |
| Stundendaten (`HOUR`-Dimension) | letzte ~8–10 Tage, `dataState=HOURLY_ALL` |
| URL-Inspektion | 2.000 pro Tag **und Property**, 600 pro Minute |
| URL-Inspektion (Projekt) | 10.000.000 pro Tag, 15.000 pro Minute |

Hinzu kommen Kurzzeit- (10 Minuten) und Tageslast-Quoten sowie QPS/QPM/QPD jeweils **pro Site, pro Nutzer und pro Cloud-Projekt**. Die genauen Werte veröffentlicht Google nur teilweise und ändert sie gelegentlich. Sie werden deshalb nicht im Code verdrahtet, sondern als Konfiguration gehalten und zur Laufzeit adaptiv nachgeführt: Jede `429`- oder `userRateLimitExceeded`-Antwort senkt die effektive Rate, längere Fehlerfreiheit hebt sie wieder an. Ein Regelkreis ist verlässlicher als eine abgeschriebene Zahl, die morgen falsch sein kann.

**Die projektweite Quote ist der Engpass des Geschäftsmodells.** Sie gilt für alle Kunden gemeinsam — daher der zentrale Rate-Limiter und der frühzeitige Antrag auf Quotenerhöhung.

Eine Grenze kommt durch den vorgelagerten Proxy hinzu: Cloudflares **Proxy Read Timeout von 125 Sekunden**. Kein Tool-Call darf synchron länger laufen. Aufträge, die das könnten, nehmen den Auftrag an und antworten sofort mit einem Fortschrittsverweis ([01-architektur.md](01-architektur.md)).

## Aufbau

```
systemd-Timer (täglich 04:10 UTC · stündlich :05 · monatlich)
        │
        ▼
  Job-Planer  ──schreibt──▶  core.sync_jobs  ──enqueue──▶  pg-boss
        │                    (fachlicher Zustand)          (Warteschlange)
        │                                                        │
        │                          ┌─────────────────────────────┘
        │                          ▼
        │                   worker: Job-Ausführung
        │                          │
        │                          ├──▶ core.rate_budget  (Token-Bucket, FOR UPDATE)
        │                          ├──▶ Google-Access-Token (LRU im Prozess)
        │                          ├──▶ searchanalytics.query (paginiert, 25.000/Seite)
        │                          ├──▶ COPY → Stage → INSERT … ON CONFLICT
        │                          └──▶ core.sync_jobs / core.sync_state fortschreiben
        ▼
  Fortschritt sichtbar über get_sync_status
```

**pg-boss statt einer externen Queue.** Die Warteschlange liegt in derselben PostgreSQL-Instanz wie die Daten. Das spart einen Dienst, macht Job-Annahme und Datenschreibung transaktional konsistent und lässt den Zustand mit normalem SQL inspizieren. Für dieses Volumen wären Redis oder RabbitMQ Betriebsaufwand ohne Gegenwert.

**Der Cursor (`sync_jobs.start_row`) wird nach jeder Seite persistiert.** Ein abgebrochener Job setzt dort wieder an, statt von vorn zu beginnen — bei einem Backfill mit Tausenden Calls der Unterschied zwischen Robustheit und einem Sisyphos-Lauf.

## Backfill

Ausgelöst, wenn eine Property erstmals `sync_enabled` erhält. Rückwärts vom aktuellen Rand, in Tageschunks je Grain.

**Reihenfolge nach Nutzwert, nicht chronologisch.** Der Nutzer soll nicht Stunden warten, bevor irgendetwas funktioniert:

1. `totals` über den gesamten Zeitraum — ein einziger Call mit `dimensions=['date']`; danach sind Trendfragen sofort beantwortbar
2. `query` und `page`, **neueste Tage zuerst** — die letzten 90 Tage decken die meisten realen Fragen ab
3. `geo_device` und `appearance` über Datumsbereiche gebündelt
4. `query_page` zuletzt, weil am teuersten und am seltensten gebraucht

**Größenordnung je Property und Suchtyp** für 16 Monate (≈ 487 Tage):

| Grain | Strategie | Calls |
|---|---|---|
| `totals` | ein Bereichsaufruf mit `date` | 1–2 |
| `query` | ein Aufruf je Tag, paginiert | 490–1.000 |
| `page` | ein Aufruf je Tag, paginiert | 490–1.000 |
| `geo_device` | Bereichsaufrufe mit `date` | 10–30 |
| `appearance` | Bereichsaufrufe mit `date` | 2–5 |
| `query_page` | ein Aufruf je Tag, paginiert | 500–1.500 |
| **Summe** | | **≈ 1.500–3.500** |

Bei konservativen zwei Calls pro Sekunde ist eine Property in 15 bis 30 Minuten reiner API-Zeit vollständig. Mit Warteschlange und Fair-Share realistisch **innerhalb einer Stunde nutzbar, innerhalb weniger Stunden vollständig**. Genau das kommuniziert `get_sync_status`, statt einen Fortschrittsbalken ohne Kontext zu zeigen.

Der Worker legt fehlende Vergangenheitspartitionen selbst an, bevor er schreibt ([03-datenmodell.md](03-datenmodell.md)).

Zusätzliche Suchtypen (`image`, `video`, `news`, `discover`, `googleNews`) vervielfachen den Aufwand und werden nur synchronisiert, wenn sie überhaupt Daten liefern — ein Probeaufruf über 30 Tage entscheidet das vorab.

## Bulk Data Export — der Hauptweg ab Pro

Ab Pro ist die API nicht mehr die laufende Quelle, sondern nur noch das Mittel für den einmaligen Backfill. Danach übernimmt Googles Bulk Data Export ([12-wettbewerb-usp.md](12-wettbewerb-usp.md)).

**Warum das die Pipeline vereinfacht:** Der Export verbraucht **keine API-Quote**. Der in diesem Kapitel beschriebene Rate-Limiter, die Fair-Share-Logik und der tägliche Delta-Sync über fünf Tage entfallen für diese Properties vollständig. Was bleibt, ist ein täglicher Auszug aus BigQuery.

**Der tägliche Auszug**

```sql
-- Läuft im UNSEREM Projekt (dort werden die gescannten Bytes abgerechnet),
-- liest aus dem Dataset des Kunden.
SELECT data_date, query, url, is_anonymized_query,
       clicks, impressions, sum_top_position
  FROM `<kunde>.<dataset>.searchdata_url_impression`
 WHERE data_date = @day        -- ZWINGEND: Partitionsfilter
```

**Der Partitionsfilter ist nicht optional.** Ohne ihn scannt jede Abfrage die vollständige Tabelle — bei einer gewachsenen Property das Hundertfache an Bytes, und zwar auf unsere Rechnung. Google hat dazu eigens einen Beitrag über BigQuery-Effizienz bei Search-Console-Exporten veröffentlicht. Ein Test in CI prüft deshalb, dass jede erzeugte Abfrage einen `data_date`-Filter trägt.

**Besonderheiten der Exportdaten**

| Eigenschaft | Folge für uns |
|---|---|
| `sum_top_position` ist bereits eine Summe, nullbasiert | Umrechnung auf unsere einsbasierte `position_sum` beim Einlesen |
| `is_anonymized_query` markiert Zeilen ohne Query-Text | fließen in den Sammelposten `query_id = 0` |
| Zwei Tabellen: `searchdata_site_impression` und `…url_impression` | erstere speist `fact_totals`, letztere `fact_query_page` und die abgeleiteten Grains |
| Daten erscheinen mit Verzug und werden nachkorrigiert | die letzten drei Tagespartitionen werden erneut gelesen und geupsertet |
| Kein Rückwirken auf die Zeit vor Aktivierung | daher der einmalige API-Backfill für die 16 Monate davor |

**Zustandsüberwachung.** `core.bq_exports.last_data_date` hält fest, wie weit der Export reicht. Bleiben Partitionen aus — abgelaufene Abrechnung, entzogene Rechte, gelöschtes Dataset —, wechselt der Status auf `degraded`, die Property fällt automatisch auf den API-Sync zurück und der Nutzer wird benachrichtigt. Ein stillschweigend versiegender Datenstrom wäre der schlimmste Fehlerfall: Er fiele erst Wochen später auf, und die Lücke ließe sich dann nicht mehr schließen, weil die API nur 16 Monate zurückreicht.

`bytes_scanned` wird kumuliert mitgeführt, damit die Kostenseite messbar bleibt und nicht erst auf der Rechnung auffällt.

## Täglicher Delta-Sync (nur ohne Bulk Export)

**Es werden immer die letzten fünf Tage neu geholt, nicht nur der neueste.** Search-Console-Daten erscheinen mit zwei bis drei Tagen Verzug und werden danach noch korrigiert. Wer nur vorwärts anhängt, friert unfertige Zahlen dauerhaft ein und erklärt später Abweichungen gegenüber der Google-Oberfläche, die er selbst verursacht hat.

Deshalb ausschließlich `INSERT … ON CONFLICT DO UPDATE` auf die Primärschlüssel — Wiederholungen sind folgenlos, was Retries trivial macht.

`dataState` wird bewusst gesetzt: `final` für den stabilen Bereich, `all` für die jüngsten Tage. Zeilen aus `all` gelten als vorläufig und werden beim nächsten Lauf überschrieben.

## Massenschreiben

Nicht Einzel-Inserts, sondern `COPY` in eine ungeloggte Staging-Tabelle, dann ein Upsert von dort ([03-datenmodell.md](03-datenmodell.md)). Der Unterschied ist keine Feinoptimierung: Bei 25.000 Zeilen je API-Seite und mehreren tausend Seiten im Backfill entscheidet er darüber, ob ein Backfill Stunden oder Tage dauert.

Die Staging-Tabelle ist je Worker-Verbindung temporär, damit parallele Jobs sich nicht ins Gehege kommen.

## Stundendaten

Nur ab Pro. Die `HOUR`-Dimension mit `dataState=HOURLY_ALL` liefert bis zu zehn Tage rückwirkend. Google gibt Zeitstempel in Pacific Time aus; sie werden beim Schreiben nach UTC normalisiert, sonst entstehen Sprünge bei der Sommerzeitumstellung.

Stundenwerte sind ausdrücklich partiell — das Feld `partial` in `wh.fact_hourly` hält das fest, und jedes Tool, das sie ausgibt, kennzeichnet sie entsprechend. Ein scheinbarer Einbruch in der laufenden Stunde ist sonst eine sichere Quelle für Fehlalarme.

## Rate-Limiting und Fairness

Der Token-Bucket liegt in `core.rate_budget` und wird mit `SELECT … FOR UPDATE` fortgeschrieben — auf einer Instanz genügt das, um Anfragen zu serialisieren. In der Cloudflare-Fassung brauchte es dafür ein Durable Object; hier sind es rund vierzig Zeilen.

Drei Ebenen:

1. **Projektweit** (`scope='project'`) — schützt die geteilte Google-Quote. Harte Obergrenze.
2. **Pro Property** (`scope='property'`) — verhindert, dass ein einzelner Backfill die Site-Quote des Kunden erschöpft.
3. **Fair Share pro Mandant** — gewichteter Round-Robin bei der Job-Auswahl, damit ein Neukunde mit fünfzig Properties nicht alle anderen blockiert.

**Prioritäten**, aufsteigend als `sync_jobs.priority`:

| Priorität | Auftragsart |
|---|---|
| 10 | Live-Fallback für eine laufende Nutzerfrage |
| 50 | täglicher Delta-Sync |
| 80 | Stunden-Sync |
| 200 | Backfill |

Ein wartender Nutzer geht immer vor einem Hintergrundauftrag. Backfills laufen als Lückenfüller — sie dürfen langsam sein, aber nie eine interaktive Anfrage verzögern. Live-Calls aus dem `app`-Prozess buchen über dieselbe Tabelle, mit Priorität 10.

**Fehlerbehandlung**

| Fehler | Reaktion |
|---|---|
| `429`, `userRateLimitExceeded` | exponentieller Backoff (1s → 2s → 4s … max 5 min), globale Rate senken |
| `403 quotaExceeded` (Tageskontingent) | Property bis zum nächsten UTC-Tag pausieren, Job zurückstellen |
| `401`, `invalid_grant` | `sync_enabled = false`, Nutzer zur Neuverbindung auffordern |
| `403 forbidden` (Zugriff verloren) | Property als unzugänglich markieren, Nutzer informieren |
| `5xx` | bis zu fünf Versuche, danach `failed` mit Fehlertext |

Nach fünf Fehlversuchen wird der Job nicht still verworfen, sondern bleibt als `failed` sichtbar und erscheint in `get_sync_status`. Ein Sync, der lautlos scheitert, ist schlimmer als gar keiner, weil er falsches Vertrauen erzeugt.

## URL-Inspektions-Budget

2.000 Abfragen pro Tag und Property sind knapp: Für eine Website mit 50.000 URLs dauert eine vollständige Runde 25 Tage. Das Budget wird deshalb bewirtschaftet statt verbraucht.

**Priorisierung** bei `bulk_inspect_urls`:

1. URLs, die der Nutzer ausdrücklich nennt
2. Seiten mit hohem Traffic, deren letzte Inspektion alt ist
3. Seiten, die zuletzt Impressionen verloren haben (Indexierungsverdacht)
4. Seiten in der Sitemap ohne jede Inspektion
5. der Rest, nach Alter

Das Tool nimmt den Auftrag an, stößt einen Job an und **antwortet sofort** — der 125-Sekunden-Deckel des Proxys lässt nichts anderes zu, und es ist ohnehin das bessere Verhalten. Die Antwort nennt, wie viele URLs eingeplant sind, wie viele auf den Folgetag rutschen und wann das Budget zurückgesetzt wird. Ein Planlimit aus [07-billing.md](07-billing.md) greift vor dem Google-Limit, damit ein Free-Nutzer nicht die gesamte Site-Quote aufbraucht.

## Wartung

| Aufgabe | Rhythmus | Mechanismus |
|---|---|---|
| Monatspartitionen zwei Monate im Voraus anlegen | monatlich | `wh.ensure_month_partitions()` |
| Monats-Rollups aktualisieren | nächtlich, letzte zwei Monate | SQL im Worker |
| Parquet-Export nach Offsite | monatlich je Property | Worker |
| `dim_query.is_brand` neu bewerten | bei Änderung von `brand_pattern` | Worker |
| `fact_hourly` beschneiden | täglich, älter als 14 Tage | `DELETE` |
| `VACUUM (ANALYZE)` auf jüngste Partitionen | nächtlich | Autovacuum reicht meist nicht nach Massen-Upserts |
| Datenbankgröße prüfen, Schwellwertalarm | täglich | Prometheus |
| Integritätstest `SUM(fact_query) = fact_totals` | nach jedem Delta-Lauf | Abfrage aus [03](03-datenmodell.md) |
| `audit_log` beschneiden | monatlich, älter als 12 Monate | `DELETE` |
| pgBackRest voll / inkrementell | wöchentlich / täglich | systemd-Timer |

Zwei Zeilen sind mehr als Routine. Der **Integritätstest** ist die einzige automatische Absicherung dagegen, dass ein Pagination- oder Sammelposten-Fehler unbemerkt in jede Segmentauswertung durchschlägt. Und **`VACUUM ANALYZE` nach Massen-Upserts** ist kein Aufräumen, sondern Voraussetzung für brauchbare Abfragepläne: Nach einem Backfill sind die Statistiken der neuen Partitionen leer, und der Planer wählt dann verlässlich das Falsche.
