# 05 — MCP-Oberfläche

## Entwurfsprinzipien

**Wenige, mächtige, komponierbare Tools.** Der Wettbewerber kommt auf 58 Tools über alle Pläne. Jedes zusätzliche Tool belegt Kontextfenster im Client und erhöht die Wahrscheinlichkeit, dass der Agent das falsche greift. Ein `search_performance` mit freien Dimensionen ersetzt ein Dutzend Spezialtools und ist für ein Sprachmodell leichter zu treffen als eine lange Auswahlliste.

**Antworten sind für ein Sprachmodell bestimmt, nicht für eine Tabellenkalkulation.** Eine Antwort mit 25.000 Zeilen ist für einen Agenten wertlos und teuer. Jedes Tool hat deshalb:

- `detail: 'summary' | 'standard' | 'full'` (Vorgabe `standard`)
- ein Zeilenbudget je Stufe (10 / 50 / 250)
- bei Kürzung einen ausdrücklichen Hinweis mit Anzahl der ausgelassenen Zeilen und einem Vorschlag zur Verfeinerung
- immer die Gesamtwerte, damit der Agent Anteile korrekt berechnet, statt sie aus der gekürzten Liste zu schätzen

**Herkunft ist immer sichtbar.** Jede Antwort trägt `source: 'warehouse' | 'live' | 'mixed'` und den tatsächlich gedeckten Zeitraum. Während eines laufenden Backfills wirken Antworten sonst unerklärlich lückenhaft.

**Anonymisierung wird ausgewiesen, nicht weggerundet.** Google liefert seltene Suchanfragen gar nicht aus. Jede Antwort mit Query-Bezug nennt den Anteil der Impressionen, der auf nicht benannte Queries entfällt. Ohne diese Angabe entstehen aus Segmentanteilen stillschweigend falsche Aussagen.

**Annotationen sind Pflicht.** Jedes Tool trägt `title` und den passenden `readOnlyHint` bzw. `destructiveHint`. Das ist zugleich Voraussetzung für die Listung im Claude Connector Directory ([11-go-to-market.md](11-go-to-market.md)) — fehlende Annotationen sind dort ein häufiger Ablehnungsgrund.

> **Umsetzung:** Der Tool-Rahmen steht in `apps/app/src/`: `defineTool`/`AnyTool` (`tool.ts`), das zentrale Zugriffs-Gate (`access.ts`), das Antwortbudget (`budget.ts`), Registry und Router (`registry.ts`, `router.ts`). Berechtigung, Eingabevalidierung und Mandantentrennung laufen zentral im Router, nie im Handler. Implementiert: die Meta-Tools (`tools/meta.ts`) sowie die datentragenden `search_performance`, `top_movers` (`tools/performance.ts`) und `compare_periods` (`tools/compare.ts`). Sie hängen an der injizierbaren `WarehouseRepo`-Schnittstelle (`repo.ts`) — die Handler-Logik ist damit ohne Datenbank getestet (`test/data-tools.test.ts`); die konkrete Drizzle-Implementierung des Repos gegen `packages/db` folgt. Die übrigen Tools aus diesem Dokument reihen sich nach demselben Muster ein.

---

## Übersicht

| Gruppe | Tools | Schreibend |
|---|---|---|
| Meta / Onboarding | 4 | – |
| Performance | 5 | – |
| Analyse-Engine | 6 | – |
| Indexierung & Technik | 5 | 1 |
| Kontext & Export | 3 | – |
| MCP Apps (interaktiv) | 3 | – |
| **Summe** | **26** | **1** |

---

## Meta und Onboarding

### `get_started`
*Willkommen, Property-Auswahl, Planübersicht.* Erster Aufruf für neue Nutzer. Listet verfügbare Properties samt Berechtigungsstufe und Sync-Zustand, schlägt den Backfill vor und nennt drei konkrete Beispielfragen, die mit den vorhandenen Daten sofort funktionieren.

### `get_capabilities`
*Maßgebliches Server-Inventar.* Verfügbare Tools, aktueller Plan, verbundene Properties, Sync-Deckung. Der Agent soll dieser Ausgabe mehr vertrauen als jeder Dokumentation — Tools verschwinden und erscheinen mit dem Plan.

### `list_properties`
```ts
{ include_sync_status?: boolean }   // Vorgabe: true
```
Properties aus der Search Console, angereichert um `covered_from`/`covered_to` je Grain und Datenfrische.

### `select_property`
```ts
{ site_url: string }
```
Setzt die aktive Property in der Sitzungs-Registry (gespiegelt nach `core.mcp_sessions`, überlebt Neustarts). Alle folgenden Aufrufe dürfen `property` weglassen. `destructiveHint: false`, aber nicht `readOnly` — es verändert Sitzungszustand.

---

## Performance

### `search_performance`
Das Arbeitspferd. Ersetzt ein Dutzend Spezialtools.

```ts
{
  property?: string,
  dimensions: ('query'|'page'|'country'|'device'|'date'|'appearance')[],
  date_from: string, date_to: string,            // oder:
  period?: 'last_7d'|'last_28d'|'last_90d'|'last_12m'|'ytd',
  compare_to?: 'previous_period'|'previous_year'|{ from: string, to: string },
  search_type?: 'web'|'image'|'video'|'news'|'discover'|'googleNews',  // Vorgabe 'web'
  filters?: {
    query?:   { op: 'contains'|'equals'|'regex'|'not_contains', value: string },
    page?:    { op: 'contains'|'equals'|'regex'|'not_contains', value: string },
    country?: string[], device?: ('DESKTOP'|'MOBILE'|'TABLET')[],
    brand?: 'brand'|'non_brand'
  },
  sort_by?: 'clicks'|'impressions'|'ctr'|'position'|'clicks_delta',
  limit?: number,
  detail?: 'summary'|'standard'|'full'
}
```

Antwort enthält immer: Gesamtwerte für Zeitraum und Vergleichszeitraum, die Zeilen, den Anteil anonymisierter Impressionen, `source` und den gedeckten Zeitraum.

### `performance_timeseries`
```ts
{ property?, granularity: 'hour'|'day'|'week'|'month', period|date_from/date_to,
  compare_to?, segment?: { dimension, value }, search_type? }
```
Zeitreihe der vier Kennzahlen. `granularity: 'hour'` nur ab Pro und nur für die letzten zehn Tage; die Antwort markiert unvollständige Stunden ausdrücklich.

### `compare_periods`
Zwei Zeiträume **mit Erklärung des Unterschieds**, nicht nur mit zwei Zahlen.

```ts
{ property?, period_a, period_b, dimension?: 'query'|'page'|'country'|'device',
  attribute_by?: 'clicks'|'impressions', top_n?: number }
```

Liefert die Zerlegung der Klickveränderung in Nachfrage-, Sichtbarkeits- und CTR-Anteil sowie die Einzelposten, die den größten Beitrag leisten. Die Rechnung steht in [06-analyse-engine.md](06-analyse-engine.md).

### `top_movers`
```ts
{ property?, dimension: 'query'|'page', metric: 'clicks'|'impressions'|'position',
  period?, compare_to?, direction?: 'up'|'down'|'both',
  min_impressions?: number,   // Vorgabe 100, unterdrückt statistisches Rauschen
  limit? }
```

### `get_sync_status`
```ts
{ property?: string }
```
Gedeckter Zeitraum je Grain, Fortschritt laufender Backfills mit Restschätzung, fehlgeschlagene Jobs im Klartext, Zeitpunkt der letzten Aktualisierung.

---

## Analyse-Engine

Der eigentliche Mehrwert. Alle Berechnungen laufen deterministisch in SQL und TypeScript — der Agent formuliert die Frage und deutet das Ergebnis, erfindet aber keine Zahlen. Formeln in [06-analyse-engine.md](06-analyse-engine.md).

### `detect_anomalies`
```ts
{ property?, period?, scope?: 'site'|'query'|'page'|'country'|'device',
  sensitivity?: 'low'|'medium'|'high', min_impressions?: number }
```
Saisonbereinigte Baseline über 28 Tage, Wochentagsmuster berücksichtigt. Ausgabe je Auffälligkeit: Datum, Ausmaß, Vertrauensmaß, betroffene Segmente — und die Angabe, ob ein bestätigtes Google-Update ins Zeitfenster fällt.

### `find_cannibalization`
```ts
{ property?, period?, min_impressions?: number, min_urls?: number, limit? }
```
Suchanfragen, für die mehrere URLs ranken. Bewertet nicht nur die Existenz mehrerer URLs, sondern deren zeitlichen Wechsel — abwechselnd rankende URLs sind das eigentliche Problem, dauerhaft parallele mit klarer Rangfolge oft harmlos.

### `striking_distance`
```ts
{ property?, period?, position_min?: number, position_max?: number,  // Vorgabe 5–20
  min_impressions?: number, limit? }
```
Suchanfragen knapp außerhalb der Sichtbarkeit, mit Klickpotenzial-Schätzung auf Basis der site-eigenen CTR-Kurve statt einer generischen Branchentabelle.

### `ctr_analysis`
```ts
{ property?, period?, scope?: 'page'|'query', deviation?: 'under'|'over'|'both', limit? }
```
Ermittelt die site-eigene CTR-nach-Position-Kurve und listet Seiten, die deutlich darunter liegen — typische Ursachen sind schwache Titel und Beschreibungen oder verlorene Rich Results.

### `brand_vs_nonbrand`
```ts
{ property?, period?, compare_to?, pattern?: string }   // pattern überschreibt properties.brand_pattern
```
Segmentiert und weist den anonymisierten Rest getrennt aus, statt ihn einer der beiden Seiten zuzuschlagen.

### `content_decay`
```ts
{ property?, lookback_months?: number, min_clicks_before?: number, limit? }
```
Seiten mit strukturellem, nicht saisonalem Klickverlust. Setzt Historie jenseits der 16 Monate voraus und ist auf einem reinen Passthrough-Modell nicht abbildbar ([12-wettbewerb-usp.md](12-wettbewerb-usp.md)).

---

## Indexierung und Technik

### `inspect_url`
```ts
{ property?, url: string, force_refresh?: boolean }
```
Indexierungsstatus, Coverage, Canonical, letzter Crawl, Rich-Result-Eignung. Antworten werden gecacht; `force_refresh` verbraucht Kontingent und sagt das auch.

### `bulk_inspect_urls`
```ts
{ property?, urls?: string[],
  select?: 'top_traffic'|'losing_traffic'|'never_inspected'|'stale', max_urls?: number }
```
Plant gegen das Tagesbudget (2.000 je Property) und meldet zurück, was geprüft wurde, was verschoben ist und wann das Budget zurückgesetzt wird.

### `index_coverage_overview`
```ts
{ property?, group_by?: 'verdict'|'coverage_state'|'directory' }
```
Aggregiert gespeicherte Inspektionen und Sitemap-Daten zu einem Überblick — mit ehrlicher Angabe, welcher Anteil der bekannten URLs überhaupt schon inspiziert wurde.

### `list_sitemaps`
```ts
{ property?, sitemap_index?: string }
```

### `submit_sitemap` — **das einzige schreibende Tool**
```ts
{ property?, sitemap_url: string, confirm: true }
```
`readOnlyHint: false`, `destructiveHint: false` (Einreichen ist additiv). Erfordert den opt-in-Scope `webmasters` sowie ein ausdrückliches `confirm`. Ein Löschen von Sitemaps ist bewusst **nicht** vorgesehen: Der Nutzen ist gering, das Schadenspotenzial hoch, und die Abwesenheit destruktiver Tools vereinfacht sowohl die Google-Verifizierung als auch die Directory-Prüfung.

---

## Kontext und Export

### `get_google_updates`
```ts
{ period?, type?: 'core'|'spam'|'discover'|'all' }
```
Bestätigte Google-Updates zur Korrelation mit Auffälligkeiten. Wird von `detect_anomalies` intern mitgenutzt.

### `export_data`
```ts
{ property?, dataset: 'query'|'page'|'query_page'|'totals',
  period, format?: 'csv'|'parquet' }
```
Erzeugt eine Datei im Objektspeicher und liefert eine präsignierte URL mit kurzer Gültigkeit. Ab Pro. Der Weg über eine URL statt über die Tool-Antwort ist zwingend — ein CSV mit 100.000 Zeilen im Kontextfenster wäre unbrauchbar und teuer.

### `show_pricing`
Planübersicht mit Upgrade-Link. Wird auch von der Limitbehandlung aufgerufen.

---

## MCP Apps (interaktive Tools)

Die MCP-Apps-Erweiterung (SEP-1865) ist seit Januar 2026 stabil und wird von Claude in Web und Desktop unterstützt. Der Server deklariert Oberflächen als `ui://`-Ressourcen, die der Client in einer abgeschotteten iframe rendert; die Kommunikation läuft über MCP-eigenes JSON-RPC. Das ist der sichtbarste Teil des Wettbewerbsprodukts — dessen „Interaktive Tools" sind genau diese Ebene.

| Tool | Oberfläche |
|---|---|
| `performance_explorer` | Zeitreihen-Diagramm mit Umschaltern für Zeitraum, Dimension und Vergleich; Auswahl im Chart erzeugt eine Folgefrage an den Agenten |
| `property_picker` | Property-Auswahl mit Sync-Status statt reiner Textliste |
| `plan_upgrade` | Planvergleich mit Stripe-Checkout direkt im Panel |

Für die Directory-Einreichung sind zu MCP Apps drei bis fünf Screenshots mit mindestens 1.000 Pixeln Breite erforderlich.

---

## MCP Prompts

Vorgefertigte Analysepfade, die der Nutzer im Client auswählen kann:

| Prompt | Ablauf |
|---|---|
| *Traffic-Einbruch analysieren* | `detect_anomalies` → `compare_periods` → `get_google_updates` → Deutung |
| *Monatsreport erstellen* | `performance_timeseries` → `top_movers` → `brand_vs_nonbrand` → Fließtext |
| *Kannibalisierung prüfen* | `find_cannibalization` → je Fall `search_performance` mit Query-Filter |
| *Quick Wins finden* | `striking_distance` → `ctr_analysis` → priorisierte Maßnahmenliste |
| *Indexierung prüfen* | `index_coverage_overview` → `bulk_inspect_urls` → Auffälligkeiten |

## MCP Resources

Property-Metadaten (`gsc://property/{id}`) und Sync-Deckung (`gsc://property/{id}/coverage`) als Ressourcen. So kann der Client Kontext einbinden, ohne einen Tool-Call zu verbrauchen.

---

## Abgleich mit dem Wettbewerber

| Advanced GSC | Bei uns |
|---|---|
| `get_capabilities`, `get_started`, `select_property`, `show_pricing` | identisch übernommen |
| `list_properties` | `list_properties`, zusätzlich mit Sync-Status |
| `get_search_analytics` | `search_performance`, mit Vergleichszeitraum und Brand-Filter |
| `explore_performance` | `performance_explorer` (MCP App) + `performance_timeseries` |
| `inspect_url_enhanced` | `inspect_url`, zusätzlich `bulk_inspect_urls` |
| `get_google_updates` | identisch, zusätzlich intern mit Anomalien verknüpft |
| `check_core_web_vitals` | **bewusst ausgelassen** — CrUX-Daten sind frei verfügbar und kein Differenzierer; für Phase 6 vorgemerkt |
| GA4 (11 Tools) | Phase 6 |
| SERP, Backlinks, Keyword Research (16 Tools) | bewusst ausgelassen, siehe [00-konzept.md](00-konzept.md) |
| — | `compare_periods` mit Attribution, `detect_anomalies`, `find_cannibalization`, `striking_distance`, `ctr_analysis`, `content_decay`, `export_data`, `get_sync_status` |

Alle vier Methodengruppen der Search Console API sind abgedeckt: `sites.list` → `list_properties`; `searchanalytics.query` → sämtliche Performance- und Analysetools; `urlInspection.index.inspect` → `inspect_url`, `bulk_inspect_urls`; `sitemaps.*` → `list_sitemaps`, `submit_sitemap` (ohne `delete`, siehe oben).

---

## Fehler- und Limitbehandlung

Limits sind kein Fehlerfall, sondern ein Gesprächsangebot. Bei Überschreitung liefert das Tool die vorhandenen Daten **plus** einen strukturierten, wörtlich weiterzugebenden Hinweis:

```
[Free-Plan] Es wurden 30 Tage ausgewertet. Ihr Plan begrenzt die Historie
auf 30 Tage; mit Starter stehen 16 Monate zur Verfügung, mit Pro die
vollständige Historie ab Sync-Beginn. → https://gsc2mcp.drossmedia.de/pricing
```

Dieses Muster nutzt auch der Wettbewerber, inklusive der ausdrücklichen Anweisung an den Agenten, den Hinweis nicht zu paraphrasieren. Es wirkt, weil es an genau der Stelle erscheint, an der der Nutzer den fehlenden Wert gerade konkret vermisst.

Technische Fehler werden in Handlungsanweisungen übersetzt: `invalid_grant` wird zu „Der Google-Zugriff wurde widerrufen — bitte hier neu verbinden", nicht zu einem OAuth-Fehlercode.
