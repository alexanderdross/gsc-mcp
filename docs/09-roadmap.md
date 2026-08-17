# 09 — Roadmap

Zwei Ziele mit unterschiedlicher Dringlichkeit: eigener Nutzen möglichst früh, kommerzieller Start ohne Umbau. Die Phasenfolge ist so geschnitten, dass Phase 1 bereits produktiv nutzbar ist und alles Weitere additiv bleibt.

## Übersicht

| Phase | Inhalt | Aufwand | Ergebnis |
|---|---|---|---|
| **0** | Setup und Anträge | 2–3 Tage | Infrastruktur steht, Google-Uhr läuft |
| **1** | MCP live (Passthrough) | 1–2 Wochen | in Claude nutzbar für eigene Properties |
| **2** | Warehouse | 2 Wochen | eigene Historie, Sampling überwunden |
| **3** | Analyse-Engine | 2 Wochen | der eigentliche Produktkern |
| **4** | Interaktiv und Web | 1–2 Wochen | MCP Apps, Dashboard, Landingpage |
| **5** | Kommerz | 2 Wochen | Stripe, Limits, Livegang |
| **6** | Ausbau | laufend | Alerts, GA4, Teams |

Gesamt bis zum kommerziellen Start: rund **zehn Wochen Arbeitszeit** — die tatsächliche Kalenderdauer bestimmt die Google-Verifizierung, nicht die Entwicklung.

---

## Phase 0 — Setup und Anträge

**Der Sinn dieser Phase ist, die Wartezeiten früh zu starten.**

- Google-Cloud-Projekt, OAuth-Client, Search Console API aktivieren
- **OAuth-Verifizierung für `webmasters.readonly` einreichen** — Datenschutzerklärung, Demo-Video, Brand Verification. Dauer: mehrere Wochen
- **Quotenerhöhung beantragen**, mit der Bedarfsrechnung aus [04-sync-pipeline.md](04-sync-pipeline.md)
- Domain, DNS, Cloudflare-Account; D1, KV, R2, Queues anlegen (EU-Residenz)
- Monorepo-Gerüst, TypeScript, Vitest, CI, Wrangler-Umgebungen `dev`/`staging`/`production`
- Stripe-Konto im Testmodus

Für die Verifizierung wird ein funktionsfähiger Zustimmungsablauf verlangt. Praktisch heißt das: Der Antrag geht raus, sobald Phase 1 den OAuth-Teil fertig hat — die restlichen Vorbereitungen laufen aber sofort.

**Risiko:** Wird die Verifizierung erst am Ende beantragt, verschiebt sie den kommerziellen Start um genau ihre Bearbeitungsdauer. Das ist der häufigste vermeidbare Fehler bei Produkten mit sensitiven Google-Scopes.

## Phase 1 — MCP live

**Ziel: eigener Nutzen ab Woche zwei.**

- OAuth Authorization Server (`workers-oauth-provider`), Metadata-Endpunkte, DCR
- Google-Verbindung, verschlüsselte Token-Ablage, Refresh-Kreislauf
- MCP-Endpunkt über Streamable HTTP, `McpAgent` mit Sitzungszustand
- Getippter GSC-Client mit Pagination, Backoff, Fehlerübersetzung
- Tools: `get_started`, `get_capabilities`, `list_properties`, `select_property`, `search_performance` (live), `performance_timeseries` (live), `inspect_url`, `list_sitemaps`
- Antwortbudget und `detail`-Stufen von Anfang an — nachträglich eingebaut wird das nie sauber

**Abnahme:** In Claude verbinden, Property wählen, „Zeig mir die Top-20-Queries der letzten 28 Tage für aip.aero" beantworten lassen. Ab hier ist das Produkt für eigene Projekte brauchbar.

## Phase 2 — Warehouse

- D1-Schema und Migrationen, `resolveDb(propertyId)` von Beginn an
- Sync-Worker: Cron, Queues, Job-Planer, Cursor-Persistenz
- Rate-Limiter als Durable Object mit den drei Ebenen
- Backfill in Nutzwert-Reihenfolge, täglicher Delta-Sync über fünf Tage
- Wörterbücher, Sammelposten, Monats-Rollups
- Warehouse-Fallback-Logik in allen Performance-Handlern, `source`-Kennzeichnung
- `get_sync_status`
- Integritätstest `SUM(fact_query) == fact_totals`

**Abnahme:** Backfill für `aip.aero` vollständig, Integritätstest grün, eine Abfrage über 16 Monate liefert Ergebnisse, die die Google-Oberfläche nicht mehr zeigen kann. **Zugleich die Gelegenheit, die Volumenrechnung aus [03-datenmodell.md](03-datenmodell.md) an echten Zahlen zu prüfen.**

## Phase 3 — Analyse-Engine

- `packages/analytics` mit Testdatensätzen und Eigenschaftstests
- Change-Attribution, Anomalie-Erkennung, CTR-Kurve, Striking Distance, Kannibalisierung, Content Decay, Brand-Split
- Tools: `compare_periods`, `top_movers`, `detect_anomalies`, `find_cannibalization`, `striking_distance`, `ctr_analysis`, `brand_vs_nonbrand`, `content_decay`
- `get_google_updates` mit Anbindung an die Anomalie-Erkennung
- `bulk_inspect_urls` mit Budgetplanung, `index_coverage_overview`
- MCP Prompts, MCP Resources
- `export_data` über R2

**Abnahme:** „Warum sind die Klicks auf /flugzeuge im Juli eingebrochen?" wird mit benannten Queries, Seiten und der Zerlegung in Nachfrage-, Ranking- und Snippet-Anteil beantwortet.

## Phase 4 — Interaktiv und Web

- MCP Apps: `performance_explorer`, `property_picker`, `plan_upgrade` als `ui://`-Ressourcen
- Landingpage mit Positionierung, Preisen, Beispieldialogen
- Kunden-Dashboard: Properties, Sync-Status, Nutzung, Konto
- Öffentliche Dokumentation, Datenschutzerklärung, AGB, Impressum, Support-Kontakt
- Screenshots und Demo-Video für Directory und Google-Verifizierung

Diese Phase erzeugt nebenbei fast alle Artefakte, die Directory-Einreichung und Google-Verifizierung ohnehin verlangen. Sie deshalb vor Phase 5 zu legen, ist kein Zufall.

## Phase 5 — Kommerz

- Stripe: Produkte, Preise, Checkout, Portal, Webhooks mit WebCrypto-Signaturprüfung und Idempotenz
- Entitlement- und Quota-Gates im Tool-Router, Deckelung statt Abweisung
- Free-Plan-Hinweise, `show_pricing`, Trial mit Erinnerungen
- Herabstufung mit 90-Tage-Aufbewahrung
- Onboarding-Strecke, Kontolöschung
- Rechtsprüfung, AVV-Vorlage
- **Directory-Einreichung** ([11-go-to-market.md](11-go-to-market.md))

**Abnahme:** Ein fremder Testnutzer schließt ohne Rückfrage Verbindung, Property-Auswahl, Backfill und Abo ab.

## Phase 6 — Ausbau

Nach Nachfrage priorisiert, nicht nach Reihenfolge:

- **Alerts und geplante Reports** — der größte Hebel, weil er das Produkt vom Werkzeug zum Dienst macht: Anomalien per E-Mail, Wochenreport als wartende Nachricht in der nächsten Claude-Sitzung
- **GA4** — zweiter OAuth-Scope, eigenes Datenmodell; erschließt Conversion-Fragen, die GSC allein nicht beantwortet
- **Team-Zugänge und White-Label** — Voraussetzung für ernsthaftes Agenturgeschäft
- **Core Web Vitals** aus CrUX — günstig zu ergänzen, guter Deckungsgrad mit dem Wettbewerber
- **Kaltarchiv-Auslagerung** — Tagesfakten über 24 Monate nach R2, Rollups bleiben in D1

---

## Kritischer Pfad

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5 ──▶ Livegang
   │                                                                        ▲
   └──── Google-OAuth-Verifizierung (mehrere Wochen) ───────────────────────┘
```

Die Entwicklung ist selten der Engpass. Wird die Verifizierung in Phase 0 angestoßen, läuft sie parallel und ist zum Ende von Phase 5 erledigt. Wird sie vergessen, steht das fertige Produkt und wartet.

## Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Google-Verifizierung dauert oder wird abgelehnt | kein kommerzieller Start | in Phase 0 einreichen; bis dahin Testmodus mit 100 Nutzern, der für Eigenbedarf und Beta reicht |
| Projektweite GSC-Quote wird zum Engpass | Backfills stauen, Antworten verzögern sich | zentraler Rate-Limiter, Prioritäten, frühzeitiger Quotenantrag |
| D1-Größenlimit erreicht | Schreibfehler im Betrieb | `resolveDb` ab Phase 2, Größenalarm, Shard-Pfad vorbereitet |
| Volumenrechnung zu optimistisch | Plan-Grenzen und Kalkulation falsch | Validierung an echten Daten am Ende von Phase 2, vor der Preisfestlegung |
| Anonymisierte Queries irritieren Nutzer | Vertrauensverlust in alle Zahlen | Anteil in jeder Antwort ausweisen, in der Dokumentation erklären |
| Wettbewerber zieht mit Warehouse nach | Alleinstellung schrumpft | Historie ist nicht rückwirkend aufholbar — der Vorsprung wächst mit jedem Betriebstag |
| Eigenbedarf lenkt vom Produkt ab | Bastellösung statt Produkt | Mandantenfähigkeit ab Phase 1 verbindlich, auch wenn zunächst nur ein Nutzer existiert |
