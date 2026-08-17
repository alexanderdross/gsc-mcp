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

Hinzu kommen Kurzzeit- (10 Minuten) und Tageslast-Quoten sowie QPS/QPM/QPD jeweils **pro Site, pro Nutzer und pro Cloud-Projekt**. Die genauen Werte veröffentlicht Google nur teilweise und ändert sie gelegentlich. Sie werden deshalb nicht im Code verdrahtet, sondern als Konfiguration gehalten und zur Laufzeit adaptiv nachgeführt: Jede `429`- oder `userRateLimitExceeded`-Antwort senkt die effektive Rate, längere Fehlerfreiheit hebt sie wieder an. Ein Regelkreis ist hier verlässlicher als eine abgeschriebene Zahl, die morgen falsch sein kann.

**Die projektweite Quote ist der Engpass des Geschäftsmodells.** Sie gilt für alle Kunden gemeinsam. Das ist der Grund für den zentralen Rate-Limiter — und für die frühzeitige Beantragung einer Quotenerhöhung.

## Aufbau

```
Cron (täglich 04:00 UTC · stündlich)
        │
        ▼
  Job-Planer ──schreibt──▶ sync_jobs (D1)  ──enqueue──▶ Cloudflare Queue
                                                             │
                                    ┌────────────────────────┘
                                    ▼
                            Queue-Consumer (Batch)
                                    │
                                    ├──▶ Rate-Limiter (Durable Object, global)
                                    │      wartet auf Token, meldet Backoff
                                    ├──▶ Google-Access-Token (KV-Cache)
                                    ├──▶ searchanalytics.query (paginiert)
                                    ├──▶ Upsert in D1 (Batch-Transaktion)
                                    └──▶ sync_jobs / sync_state fortschreiben
```

Der Cursor (`sync_jobs.start_row`) wird **nach jeder Seite** persistiert. Ein abgebrochener Job setzt dort wieder an, statt von vorn zu beginnen — bei einem Backfill mit Tausenden Calls ist das der Unterschied zwischen Robustheit und einem Sisyphos-Lauf.

## Backfill

Wird ausgelöst, wenn eine Property erstmals `sync_enabled` gesetzt bekommt. Rückwärts vom aktuellen Rand, in Tageschunks je Grain.

**Reihenfolge nach Nutzwert, nicht chronologisch.** Der Nutzer soll nicht Stunden warten, bevor irgendetwas funktioniert:

1. `totals` über den gesamten Zeitraum — ein einziger Call mit `dimensions=['date']`, danach sind Trendfragen sofort beantwortbar
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

Bei einer konservativen Dauerrate von zwei Calls pro Sekunde ist eine Property in etwa 15 bis 30 Minuten reiner API-Zeit vollständig. Realistisch ist mit Warteschlange und Fair-Share **innerhalb einer Stunde nutzbar, innerhalb weniger Stunden vollständig**. Genau das kommuniziert `get_sync_status`, statt einen Fortschrittsbalken ohne Kontext zu zeigen.

Zusätzliche Suchtypen (`image`, `video`, `news`, `discover`, `googleNews`) vervielfachen den Aufwand und werden deshalb nur synchronisiert, wenn sie überhaupt Daten liefern — ein Probeaufruf über 30 Tage entscheidet das vorab.

## Täglicher Delta-Sync

**Es werden immer die letzten fünf Tage neu geholt, nicht nur der neueste.** Search-Console-Daten erscheinen mit zwei bis drei Tagen Verzug und werden danach noch korrigiert. Wer nur vorwärts anhängt, friert unfertige Zahlen dauerhaft ein und erklärt später Abweichungen gegenüber der Google-Oberfläche, die er selbst verursacht hat.

Deshalb ausschließlich `INSERT ... ON CONFLICT DO UPDATE` auf die Primärschlüssel — Wiederholungen sind dadurch folgenlos, was zugleich Retries trivial macht.

`dataState` wird bewusst gesetzt: `final` für den stabilen Bereich, `all` für die jüngsten Tage. Zeilen aus `all` werden als vorläufig markiert und beim nächsten Lauf überschrieben.

## Stundendaten

Nur ab Pro. Die `HOUR`-Dimension mit `dataState=HOURLY_ALL` liefert bis zu zehn Tage rückwirkend. Google gibt Zeitstempel in Pacific Time aus; sie werden beim Schreiben nach UTC normalisiert, sonst entstehen Sprünge bei der Sommerzeitumstellung.

Stundenwerte sind ausdrücklich partiell. Jedes Tool, das sie ausgibt, kennzeichnet sie entsprechend — ein scheinbarer Einbruch in der laufenden Stunde ist sonst eine sichere Quelle für Fehlalarme.

## Rate-Limiting und Fairness

Der Rate-Limiter ist ein einzelnes Durable Object mit drei Ebenen:

1. **Projektweit** — schützt die geteilte Google-Quote. Harte Obergrenze.
2. **Pro Property** — verhindert, dass ein einzelner Backfill die Site-Quote des Kunden erschöpft.
3. **Fair Share pro Mandant** — gewichteter Round-Robin, damit ein Neukunde mit fünfzig Properties nicht alle anderen blockiert.

**Prioritäten**, aufsteigend als `sync_jobs.priority`:

| Priorität | Auftragsart |
|---|---|
| 10 | Live-Fallback für eine laufende Nutzerfrage |
| 50 | täglicher Delta-Sync |
| 80 | Stunden-Sync |
| 200 | Backfill |

Ein wartender Nutzer geht immer vor einem Hintergrundauftrag. Backfills laufen als Lückenfüller — sie dürfen langsam sein, aber nie eine interaktive Anfrage verzögern.

**Fehlerbehandlung**

| Fehler | Reaktion |
|---|---|
| `429`, `userRateLimitExceeded` | exponentieller Backoff (1s → 2s → 4s … max 5 min), globale Rate senken |
| `403 quotaExceeded` (Tageskontingent) | Property bis zum nächsten UTC-Tag pausieren, Job zurückstellen |
| `401`, `invalid_grant` | `sync_enabled = 0`, Nutzer zur Neuverbindung auffordern |
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

Das Tool meldet ausdrücklich zurück, wie viele URLs geprüft wurden, wie viele auf den Folgetag verschoben sind und wann das Budget zurückgesetzt wird. Ein zusätzlicher Deckel (Planlimit aus [07-billing.md](07-billing.md)) greift vor dem Google-Limit, damit ein Free-Nutzer nicht die gesamte Site-Quote eines Kunden aufbraucht.

## Wartung

| Aufgabe | Rhythmus |
|---|---|
| Monats-Rollups aktualisieren | nächtlich, letzte zwei Monate |
| Parquet-Export nach R2 | monatlich je Property |
| `dim_query.is_brand` neu bewerten | bei Änderung von `brand_pattern` |
| `fact_hourly` beschneiden | täglich, älter als 14 Tage |
| Datenbankgröße prüfen, Shard-Alarm | täglich |
| Integritätstest `SUM(fact_query) == fact_totals` | nach jedem Delta-Lauf, stichprobenartig |
| `audit_log` beschneiden | monatlich, älter als 12 Monate |

Der Integritätstest ist kein Beiwerk. Er ist die einzige automatische Absicherung dagegen, dass ein Pagination- oder Sammelposten-Fehler unbemerkt in jede Segmentauswertung durchschlägt — siehe [03-datenmodell.md](03-datenmodell.md).
