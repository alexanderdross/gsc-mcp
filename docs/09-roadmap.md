# 09 — Roadmap

Zwei Ziele mit unterschiedlicher Dringlichkeit: eigener Nutzen möglichst früh, kommerzieller Start ohne Umbau. Die Phasenfolge ist so geschnitten, dass Phase 1 bereits produktiv nutzbar ist und alles Weitere additiv bleibt.

## Übersicht

| Phase | Inhalt | Aufwand | Ergebnis |
|---|---|---|---|
| **0** | Setup und Anträge | 3–4 Tage | Infrastruktur steht, Google-Uhr läuft |
| **1** | MCP live (Passthrough) | 1–2 Wochen | in Claude nutzbar für eigene Properties |
| **2** | Warehouse: API-Backfill **und** Bulk Export | 3 Wochen | eigene Historie, vollständige Daten — der USP |
| **3** | Analyse-Engine | 2 Wochen | der eigentliche Produktkern |
| **4** | Interaktiv und Web | 1–2 Wochen | MCP Apps, Dashboard, Landingpage |
| **5** | Kommerz | 2 Wochen | Stripe, Limits, Livegang |
| **6** | Ausbau | laufend | Alerts, GA4, Teams |

Gesamt bis zum kommerziellen Start: rund **elf Wochen Arbeitszeit**. Die tatsächliche Kalenderdauer bestimmt die Google-Verifizierung, nicht die Entwicklung.

> **Stand der Umsetzung:** Die netzwerkunabhängige Kernlogik ist gebaut und getestet — `packages/core`, `packages/analytics`, `packages/db`, `packages/gsc-client` sowie die Gerüste `apps/app` (Registry, Router, Gates) und `apps/worker` (Rate-Limiter, Job-Planung, Bulk-Export-Transformationen). Offen ist die netzwerkseitige Verdrahtung aus Phase 1 (MCP-Transport, OAuth-Provider, Google-Anbindung) sowie alle Schritte, die externe Infrastruktur berühren.

---

## Phase 0 — Setup und Anträge

**Der Sinn dieser Phase ist, die Wartezeiten früh zu starten.**

- **Subdomain `gsc2mcp.drossmedia.de`** in der bestehenden Cloudflare-Zone anlegen (kostenlos, keine Registrierung). Ein proxied Host, pfadgeroutet für Web/MCP/OAuth; dazu `gsc2mcp-direct.drossmedia.de` als DNS-only-Direktweg ([01-architektur.md](01-architektur.md))
- Google-Cloud-Projekt, OAuth-Client, Search Console API aktivieren
- **OAuth-Verifizierung für `webmasters.readonly` einreichen** — Datenschutzerklärung, Demo-Video, Brand Verification. Dauer: mehrere Wochen
- **Quotenerhöhung beantragen**, mit der Bedarfsrechnung aus [04-sync-pipeline.md](04-sync-pipeline.md)
- netcup RS bestellen, Debian aufsetzen, härten; Docker, PostgreSQL, Caddy
- Cloudflare-Zone einrichten: Full (strict), Origin-Zertifikat, Authenticated Origin Pulls, Ratenbegrenzung auf `/register` und `/token`, kein Caching auf `/mcp`
- **Dienstkonto für BigQuery-Lesezugriff** anlegen; `roles/bigquery.jobUser` im eigenen Projekt, damit Abfragen dort abgerechnet werden
- Offsite-Objektspeicher (EU) für Backups
- Monorepo-Gerüst, TypeScript, Vitest, CI
- Stripe-Konto im Testmodus

Die Domain steht ganz oben, weil die Google-Verifizierung sie voraussetzt: Die Datenschutzerklärung muss auf der verifizierten Domain liegen, bevor der Antrag überhaupt bearbeitet wird.

**Risiko:** Wird die Verifizierung erst am Ende beantragt, verschiebt sie den kommerziellen Start um genau ihre Bearbeitungsdauer. Der häufigste vermeidbare Fehler bei Produkten mit sensitiven Google-Scopes.

## Phase 1 — MCP live

**Ziel: eigener Nutzen ab Woche zwei.**

- OAuth Authorization Server (`node-oidc-provider`), Metadata-Endpunkte, DCR
- Google-Verbindung, verschlüsselte Token-Ablage, Refresh-Kreislauf
- MCP-Endpunkt über Streamable HTTP, **SSE-Keepalive alle 30 Sekunden** (sonst reißt die Verbindung hinter Cloudflare nach 15 Minuten)
- Sitzungs-Registry mit Spiegelung nach `core.mcp_sessions`
- Getippter GSC-Client mit Pagination, Backoff, Fehlerübersetzung
- Tools: `get_started`, `get_capabilities`, `list_properties`, `select_property`, `search_performance` (live), `performance_timeseries` (live), `inspect_url`, `list_sitemaps`
- Antwortbudget und `detail`-Stufen von Anfang an — nachträglich eingebaut wird das nie sauber

**Abnahme:** In Claude verbinden, Property wählen, „Zeig mir die Top-20-Queries der letzten 28 Tage für aip.aero" beantworten lassen. Anschließend **auf `staging` hinter dem Cloudflare-Proxy** prüfen, dass eine Sitzung über 20 Minuten Leerlauf hält. Ab hier ist das Produkt für eigene Projekte brauchbar.

## Phase 2 — Warehouse

Die längste Phase, weil sie zwei Datenwege baut. Der zweite ist der USP.

**Entschieden:** Der Bulk Data Export liegt im BigQuery-Projekt des Kunden; wir lesen mit einem Dienstkonto, dem der Kunde `bigquery.dataViewer` auf dem Dataset erteilt. Kein zusätzlicher OAuth-Scope, Speicher beim Kunden (meist im Freikontingent), Scan-Kosten bei uns. Begründung und Einrichtungsweg in [12-wettbewerb-usp.md](12-wettbewerb-usp.md).

- PostgreSQL-Schema und Migrationen, Partitionsverwaltung
- Sync-Worker: pg-boss, Job-Planer, Cursor-Persistenz, systemd-Timer
- Rate-Limiter über `core.rate_budget` mit den drei Ebenen
- **Weg A — API-Backfill:** 16 Monate rückwärts in Nutzwert-Reihenfolge, `COPY` in Staging plus Upsert
- **Weg B — Bulk Data Export:** Einrichtung anleiten und prüfen, täglich eine Tagespartition aus BigQuery nach PostgreSQL spiegeln — **stets mit `data_date`-Filter**, sonst scannt jede Abfrage die ganze Tabelle auf unsere Rechnung
- Zustandsüberwachung `core.bq_exports`: bleiben Partitionen aus, Rückfall auf den API-Sync und Benachrichtigung
- Wörterbücher, Sammelposten für anonymisierte Anfragen, Monats-Rollups
- Warehouse-Fallback-Logik in allen Performance-Handlern, `source`-Kennzeichnung
- `get_sync_status`, Integritätstest `SUM(fact_query) = fact_totals`

**Abnahme:** Backfill für `aip.aero` vollständig, Bulk Export aktiv und gespiegelt, Integritätstest grün, eine Abfrage über 16 Monate liefert Ergebnisse, die die Google-Oberfläche nicht mehr zeigen kann. **Zugleich die Gelegenheit, die Volumenschätzung aus [03-datenmodell.md](03-datenmodell.md) an echten Zahlen zu prüfen** — insbesondere, wie viele verschiedene Suchanfragen pro Tag tatsächlich auftreten.

## Phase 3 — Analyse-Engine

- `packages/analytics` mit Testdatensätzen und Eigenschaftstests
- Change-Attribution, Anomalie-Erkennung, CTR-Kurve, Striking Distance, Kannibalisierung, Content Decay, Brand-Split
- Tools: `compare_periods`, `top_movers`, `detect_anomalies`, `find_cannibalization`, `striking_distance`, `ctr_analysis`, `brand_vs_nonbrand`, `content_decay`
- `get_google_updates` mit Anbindung an die Anomalie-Erkennung
- `bulk_inspect_urls` mit Budgetplanung, `index_coverage_overview`
- MCP Prompts, MCP Resources
- `export_data` über Objektspeicher

**Abnahme:** „Warum sind die Klicks auf /flugzeuge im Juli eingebrochen?" wird mit benannten Queries, Seiten und der Zerlegung in Nachfrage-, Ranking- und Snippet-Anteil beantwortet.

## Phase 4 — Interaktiv und Web

- MCP Apps: `performance_explorer`, `property_picker`, `plan_upgrade` als `ui://`-Ressourcen
- **Ein Panel, das durch die Bulk-Export-Einrichtung führt** — der Schritt ist der einzige echte Onboarding-Widerstand und verdient eine geführte Oberfläche
- Landingpage mit Positionierung, Preisen, Beispieldialogen
- Kunden-Dashboard: Properties, Sync-Status, Nutzung, Konto
- Öffentliche Dokumentation, Datenschutzerklärung, AGB, Impressum, Support-Kontakt
- Eine `ai-info`-Faktenseite für Sprachmodelle ([11-go-to-market.md](11-go-to-market.md))
- Screenshots und Demo-Video für Directory und Google-Verifizierung

Diese Phase erzeugt fast alle Artefakte, die Directory-Einreichung und Google-Verifizierung ohnehin verlangen. Sie vor Phase 5 zu legen ist kein Zufall.

## Phase 5 — Kommerz

- Stripe: Produkte, Preise, Checkout, Portal, Webhooks mit Signaturprüfung und Idempotenz
- Entitlement- und Quota-Gates im Tool-Router, Deckelung statt Abweisung
- Free-Plan-Hinweise, `show_pricing`, Trial mit Erinnerungen
- Herabstufung mit 90-Tage-Aufbewahrung
- Onboarding-Strecke, Kontolöschung
- **Wiederherstellungsübung** aus dem Backup — vor dem Livegang, nicht im Ernstfall
- Rechtsprüfung, AVV-Vorlage, Unterauftragsverarbeiter-Liste inkl. Cloudflare
- **Directory-Einreichung** ([11-go-to-market.md](11-go-to-market.md))

**Abnahme:** Ein fremder Testnutzer schließt ohne Rückfrage Verbindung, Property-Auswahl, Bulk-Export-Einrichtung, Backfill und Abo ab.

## Phase 6 — Ausbau

Nach Nachfrage priorisiert:

- **Alerts und geplante Reports** — nach der Wettbewerbsanalyse der wichtigste Punkt der Liste, weil ihn im MCP-Feld niemand anbietet und er das Produkt vom Werkzeug zum Dienst macht
- **Warm Standby** — zweiter Server mit Streaming-Replikation; Voraussetzung, um Verfügbarkeit vertraglich zuzusagen
- **GA4** — zweiter OAuth-Scope, eigenes Datenmodell; bekannter Rückstand gegenüber dem Wettbewerber
- **Team-Zugänge und White-Label** — Voraussetzung für ernsthaftes Agenturgeschäft
- **Kaltarchiv-Auslagerung** — Tagesfakten über 24 Monate in den Objektspeicher, Rollups bleiben in PostgreSQL

---

## Kritischer Pfad

```
Phase 0 ──▶ 1 ──▶ 2 ──▶ 3 ──▶ 4 ──▶ 5 ──▶ Livegang
   │                                          ▲
   ├── Google-OAuth-Verifizierung (Wochen) ───┤
   └── Domain + Datenschutzerklärung ─────────┘
        (Voraussetzung der Verifizierung)
```

Die Entwicklung ist selten der Engpass. Wird die Verifizierung in Phase 0 angestoßen, läuft sie parallel und ist zum Ende von Phase 5 erledigt. Wird sie vergessen, steht das fertige Produkt und wartet.

## Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Google-Verifizierung dauert oder wird abgelehnt | kein kommerzieller Start | in Phase 0 einreichen; bis dahin Testmodus mit 100 Nutzern, der für Eigenbedarf und Beta reicht |
| **Wettbewerber besetzt die Bulk-Export-Position zuerst** | der USP fällt | prüfen, ob es bereits jemand tut ([12](12-wettbewerb-usp.md)); Phase 2 nicht verzögern |
| Bulk-Export-Einrichtung schreckt Nutzer ab | Konversion bricht ein | geführtes Panel in Phase 4; Starter-Plan funktioniert ohne Bulk Export |
| Preisdruck durch kostenlose Alternativen | Einstiegspläne tragen nicht | Schwerpunkt auf Agenturgeschäft, siehe [07-billing.md](07-billing.md) |
| Server fällt aus | Connector offline, Kunden merken es | externe Überwachung auf **beiden** Hostnamen, Warm Standby in Phase 6 |
| Cloudflare-Ausfall | Connector offline, obwohl Server läuft | dokumentierter Direktweg über `gsc2mcp-direct.drossmedia.de` |
| SSE-Keepalive vergessen | sporadische Verbindungsabbrüche, schwer zuzuordnen | in Phase 1 auf `staging` hinter dem echten Proxy prüfen |
| Datenverlust im Archiv | Alleinstellungsmerkmal weg — Daten über 16 Monate sind nirgends sonst | pgBackRest mit PITR, monatliche Parquet-Exporte, **Wiederherstellungsübung in Phase 5** |
| Volumenschätzung zu optimistisch | Kalkulation falsch | Validierung an echten Daten am Ende von Phase 2, vor der Preisfestlegung |
| Eigenbedarf lenkt vom Produkt ab | Bastellösung statt Produkt | Mandantenfähigkeit ab Phase 1 verbindlich, auch wenn zunächst nur ein Nutzer existiert |
