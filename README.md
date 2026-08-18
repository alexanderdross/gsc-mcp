# GSC-MCP

Remote-MCP-Server, der Google-Search-Console-Daten in Claude, ChatGPT und Cursor verfügbar macht — auf Basis von **Googles vollständigem Datenexport** statt der limitierten API.

**Domain:** `gsc2mcp.drossmedia.de` · **Betrieb:** netcup Root Server, Nürnberg, mit Cloudflare davor

> **Status:** Die gesamte Anwendung steht als getesteter Code — MCP-Server (JSON- und SSE-Transport), OAuth-Authorization-Server, beide Datenpfade (Lesen und Ingest), Sync-Worker und HTTP-Bootstrap, dazu die Deploy-Artefakte. 253 Tests, davon 34 gegen echtes PostgreSQL. Offen ist nur noch das Anbinden an reale externe Systeme (GCP-OAuth-Client samt Google-Verifizierung, BigQuery-Dienstkonto, Server-Bestellung, Live-DNS). Der [Umsetzungsstand (docs/13)](docs/13-status.md) hält das PR-übergreifend fest.

## Worum es geht

Die Search Console API ist eng begrenzt: 16 Monate Historie, 25.000 Zeilen pro Request, rund 50.000 Zeilen pro Tag und Suchtyp. **Ausnahmslos jedes Werkzeug am Markt nutzt diese API** — auch die, die Daten anschließend speichern. Sie speichern damit eine Stichprobe.

Googles *Bulk Data Export* hat keine dieser Grenzen: vollständige Suchdaten, täglich, ohne API-Quote, unbegrenzt aufbewahrbar. Was ihm fehlt, ist alles andere — keine Oberfläche, keine Analyse, kein Agentenzugang.

GSC-MCP schließt genau diese Lücke und ergänzt eine deterministische Analyse-Engine: Change-Attribution, saisonbereinigte Anomalie-Erkennung, site-eigene CTR-Kurven, Kannibalisierungs-Zeitreihen. Die Zahlen sind nachrechenbar, nicht geschätzt.

Wie groß der Unterschied ist, ist gemessen: Bei `sc-domain:aip.aero` entfallen auf die 100 klickstärksten Suchanfragen **8,3 % der Klicks** — rund 92 % des Geschehens liegen außerhalb dessen, was ein Werkzeug mit Zeilendeckel zeigt.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [00 — Konzept](docs/00-konzept.md) | Vision, Marktumfeld, Zielgruppen |
| [01 — Architektur](docs/01-architektur.md) | netcup + Cloudflare, Komponenten, Skalierungspfad |
| [02 — Auth](docs/02-auth.md) | Die zwei OAuth-Ebenen, Google-Verifizierung, Token-Handling |
| [03 — Datenmodell](docs/03-datenmodell.md) | PostgreSQL-Schema, Partitionierung, Volumenrechnung |
| [04 — Sync-Pipeline](docs/04-sync-pipeline.md) | Backfill, Delta-Sync, Quoten-Mathematik, Fehlerverhalten |
| [05 — Tools](docs/05-tools.md) | Die MCP-Oberfläche: 26 Tools, Schemata, Antwortbudgets |
| [06 — Analyse-Engine](docs/06-analyse-engine.md) | Die Formeln hinter Attribution, Anomalien, CTR-Kurven |
| [07 — Billing](docs/07-billing.md) | Plan-Matrix, Stripe-Objekte, Entitlements |
| [08 — Sicherheit & DSGVO](docs/08-security-dsgvo.md) | Datenresidenz, Verschlüsselung, Löschkonzept |
| [09 — Roadmap](docs/09-roadmap.md) | Phasen 0–6, Aufwände, Risiken |
| [10 — Repo-Struktur](docs/10-repo-struktur.md) | Monorepo-Layout, Tooling |
| [11 — Go-to-Market](docs/11-go-to-market.md) | Connector Directory, Kanäle, Launch |
| [**12 — Wettbewerb & USP**](docs/12-wettbewerb-usp.md) | Marktscan, ehrliche Prüfung der Differenzierer, Positionierung |
| [13 — Umsetzungsstand](docs/13-status.md) | PR-übergreifender Ist-Zustand des Codes, Testtiefe, offene Betreiber-Schritte |

## Architektur in Kürze

```
Claude / ChatGPT / Cursor
        │  Streamable HTTP + OAuth 2.1
        ▼
   Cloudflare (TLS, DDoS, WAF, Rate Limiting)
        │
        ▼
   netcup Root Server · Nürnberg
     Caddy → app (MCP + OAuth AS) · web · worker
     PostgreSQL 17 (Warehouse, pg-boss, Rate-Budget)
        │
        ├──▶ Search Console API      (einmaliger 16-Monats-Backfill)
        └──▶ BigQuery Bulk Export    (laufend, vollständig, ohne API-Quote)
```

Ein zweiter Hostname `gsc2mcp-direct.drossmedia.de` läuft ohne Cloudflare direkt auf den Server — für Kunden, deren Beschaffung keinen US-Auftragsverarbeiter zulässt, und als Notweg bei einem Proxy-Ausfall.

## Projektstruktur

Monorepo, npm-Workspaces, TypeScript strict, Vitest.

| Package | Rolle | Status |
|---|---|---|
| `packages/core` | Plan-Matrix, Entitlements, Metrik-Grundregeln | ✅ getestet |
| `packages/analytics` | Change-Attribution, CTR-Kurve (isoton) — der USP | ✅ getestet |
| `packages/db` | Drizzle-Modelle, kanonische Migration, Abstimmungs-Helfer | ✅ getestet |
| `packages/gsc-client` | Search-Console-Client: Pagination, Backoff, Fehlerübersetzung | ✅ getestet |
| `apps/app` | MCP-Server (JSON + SSE), OAuth-AS, HTTP-Routing, Bootstrap | ✅ getestet |
| `apps/worker` | Sync: Rate-Limiter, Planer, beide Ingest-Pfade, pg-boss-Konsument | ✅ getestet |

Die kanonische DDL liegt in `packages/db/migrations/0001_init.sql` und wird gegen echtes PostgreSQL validiert; [docs/03](docs/03-datenmodell.md) begründet sie.

## Entwicklung

```bash
npm install
npm run typecheck   # tsc --build über alle Packages
npm test            # Vitest über packages/*/test und apps/*/test
```

CI (GitHub Actions) prüft zusätzlich die Migration gegen ein echtes PostgreSQL, die Konzeptdokumente (Links, Konsistenz) und die Übersichtsseite in beiden Themes. Siehe [docs/10-repo-struktur.md](docs/10-repo-struktur.md) und `CLAUDE.md`.

## Nächste Schritte

Der kritische Pfad ist nicht der Code, sondern die **Google-OAuth-Verifizierung** für den sensitiven Scope `webmasters.readonly` — sie dauert typischerweise mehrere Wochen und setzt Domain und Datenschutzerklärung voraus. Details in [docs/02-auth.md](docs/02-auth.md) und [docs/09-roadmap.md](docs/09-roadmap.md).

Vor Phase 2 ist außerdem zu entscheiden, wohin der Bulk Data Export liefert — in das BigQuery-Projekt des Kunden oder in unseres. Die Abwägung steht in [docs/12-wettbewerb-usp.md](docs/12-wettbewerb-usp.md).
