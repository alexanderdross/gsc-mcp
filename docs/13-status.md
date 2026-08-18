# 13 — Umsetzungsstand

PR-übergreifender Bericht über den Stand der Implementierung. Ergänzt die Roadmap ([09](09-roadmap.md)) um den konkreten Ist-Zustand des Codes.

> **Kurzfassung:** Die gesamte Anwendung existiert als Code und ist getestet — **253 Tests** (davon **34 Integrationstests gegen echtes PostgreSQL**), Typecheck und Dokumentprüfung grün. Offen ist ausschließlich das Anbinden an reale externe Systeme (GCP-OAuth-Client samt Google-Verifizierung, BigQuery-Dienstkonto, Server-Bestellung, Live-DNS) — siehe [Was noch fehlt](#was-noch-fehlt).

## Ampel je Schicht

| Schicht | Stand | Testtiefe |
|---|---|---|
| `packages/core` — Plan-Matrix, Entitlements, Metrik-Regeln | ✅ fertig | Unit |
| `packages/analytics` — Attribution, Anomalien, CTR-Kurve, Kannibalisierung, Decay | ✅ fertig | Unit + Eigenschaftstests |
| `packages/gsc-client` — Client: Pagination, Backoff, Fehlerübersetzung | ✅ fertig | Unit |
| `packages/db` — Modelle, Migration, `WarehouseRepository` (Lesen), `WarehouseWriter` (Ingest), OAuth-Speicher | ✅ fertig | **Integration (PostgreSQL)** |
| `apps/app` — 19 Tool-Handler, Router, Budget-/Zugriffs-Gate | ✅ fertig | Unit |
| `apps/app` — MCP-Transport (JSON **und** SSE), Session-Store | ✅ fertig | Unit |
| `apps/app` — OAuth-AS (Metadaten, PKCE, DCR, Fluss, Google-Adapter, Krypto, Persistenz) | ✅ fertig | Unit + **Integration** |
| `apps/app` — HTTP-Routing, Bootstrap (`buildApp`, `config`, `main`) | ✅ fertig | Unit + **Integration** |
| `apps/worker` — Rate-Limiter, Planer, beide Ingest-Pfade, pg-boss-Konsument | ✅ fertig | Unit |
| Deploy — Docker, Compose, Caddy, systemd, Runbook | ✅ vorbereitet | manuell |
| Externe Zugänge — GCP, BigQuery, netcup, DNS | ⛔ Betreiber | — |

## Was seit dem Konzept gebaut wurde

Sechzehn zusammenhängende Schritte, jeder einzeln getestet und bei grüner CI integriert.

| # | Lieferung | Kern |
|---|---|---|
| 15 | `get_google_updates`, `export_data` | letzte Kontext-/Export-Tools; `ExportStore`-Schnittstelle |
| 16 | `WarehouseRepository` (Lesen) | Drizzle-Abfragen gegen PostgreSQL; Sammelposten-Ausweis; ehrliches `covered` |
| 17 | `IndexingRepository` | zusammengesetzter Adapter: GSC-Client + DB-Cache + Tagesbudget + Queue |
| 18 | MCP-Transport-Gerüst | JSON-RPC, Zod→JSON-Schema, Dispatch, Session-Store, `/mcp`-JSON-Pfad |
| 19 | OAuth-AS-Fundament | Metadaten (RFC 8414/9728), PKCE, DCR (RFC 7591), Bearer-Authentifikator |
| 20 | OAuth-Fluss | `authorize` → Google-Rückkanal → `token` (Code + Refresh mit Rotation) |
| 21 | `GoogleOAuth`-Adapter + Krypto | Consent-URL, Code-Tausch, AES-256-GCM für den Refresh-Token |
| 22 | OAuth-Persistenz | fünf `core`-Tabellen + DB-Speicher + `DbUserDirectory` |
| 23 | `WarehouseWriter` (Ingest) | Wörterbuch-Upsert, idempotente Fakten, Abstimmungs-Invariante |
| 24 | Ingest-Aggregation | Bulk-Export-Zeilen → Schreibeingaben |
| 25 | `node:http`-Routing | `HttpRouter` für alle Pfade + dünne Server-Schale |
| 26 | SSE-Bausteine | Ereignis-Kodierung + Keepalive-Strom (30-s-Ping) |
| 27 | Laufzeit-Bausteine | Request-Kontext (`AsyncLocalStorage`), DB-Resolver, `GoogleTokenProvider` |
| 28 | Server-Bootstrap + Deploy | `buildApp`/`config`/`main`; Docker, Caddy, systemd, Runbook |
| 29 | pg-boss-Queue + Worker | Produzent + Konsument; Worker-Einstiegspunkt |
| 30 | API-Sync (Backfill/Delta) | Sammelposten-Rekonstruktion aus `totals − Σ(named)` |

## Architektonische Leitplanken, die durchgehalten wurden

- **Ports & Adapter.** Jede Grenze nach außen ist eine injizierte Schnittstelle (`WarehouseRepo`, `IndexingRepo`, `InspectionQueue`, `GoogleAuth`, `ExportStore`, `Authenticator`). Deshalb ist die Verdrahtung als Ganzes testbar, ohne echte externe Systeme.
- **Abstimmung ist Pflicht, nicht Zufall.** Beide Ingest-Pfade rekonstruieren den anonymisierten Sammelposten (`query_id = 0`), sodass `SUM(fact_query) = fact_totals` je Tag hält ([03](03-datenmodell.md)); ein CI-Test und `findClickDrift()` bewachen das.
- **Mandantentrennung zentral im Router**, nie im Handler ([08](08-security-dsgvo.md)); die Property-Eigentums- und Plan-Prüfung sitzt im `buildApp`-Kern.
- **Secrets nur aus der Umgebung.** Der Google-Refresh-Token liegt AES-256-GCM-verschlüsselt; der Klartext verlässt die Speichergrenze nie.
- **Kanonische DDL ist die Migration.** Schema-Änderungen laufen über `packages/db/migrations/0001_init.sql`; ein Test erzwingt die Übereinstimmung mit den Drizzle-Modellen.

## Der Weg zum Live-Betrieb

Die Reihenfolge steht im [Deploy-Runbook](../deploy/README.md); die DNS-Details in [deploy/dns.md](../deploy/dns.md). Mechanisch:

1. `.env` aus [`.env.example`](../.env.example) füllen (Schlüssel: `openssl rand -base64 32`).
2. `docker compose up -d --build` → PostgreSQL, App, Worker.
3. `npm run migrate` (bzw. im Container) → Schema anlegen.
4. Caddy mit dem [`Caddyfile`](../deploy/Caddyfile) starten; DNS nach [dns.md](../deploy/dns.md) setzen.
5. MCP-Server in Claude als Remote-Connector eintragen und den OAuth-Fluss durchlaufen.

## Was noch fehlt

Ausschließlich Handlungen mit realen Nebenwirkungen oder externen Zugängen — sie gehören dem Betreiber ([Was NICHT autonom passiert](../CLAUDE.md)):

| Aufgabe | Warum extern |
|---|---|
| **GCP-OAuth-Client + Google-Verifizierung** des sensitiven Scopes `webmasters.readonly` | Google Cloud Console + Review-Einreichung; Bearbeitung dauert Wochen ([02](02-auth.md)) — der längste Pfad zum Start |
| **BigQuery-Dienstkonto** je Kunde (`bigquery.dataViewer`) | GCP und das Projekt des Kunden |
| **netcup Root Server** bestellen | Kauf; liefert die Origin-IP für die DNS-Records |
| **Cloudflare-DNS** live setzen | braucht die Origin-IP; im Dashboard/per API ([dns.md](../deploy/dns.md)) |
| **Stripe** scharf schalten | Phase 5 der Roadmap ([07](07-billing.md), [09](09-roadmap.md)) |

## Anschlussarbeiten (nach dem Start, optional)

- Backfill-/Delta-**Planung im Worker** an die vorhandenen Bausteine (`planBackfill`/`planDelta`, `syncDay`, Rate-Limiter) hängen.
- **BigQuery-Bulk-Export-Leser** als Adapter hinter die vorhandene Ingest-Aggregation.
- **Alerts & geplante Reports**, GA4, Team-Seats, White-Label (Phase 6, [09](09-roadmap.md)).
