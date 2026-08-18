# GSC-MCP

Remote-MCP-Server, der Google-Search-Console-Daten in Claude, ChatGPT und Cursor verfügbar macht — auf Basis von **Googles vollständigem Datenexport** statt der limitierten API.

**Domain:** `gsc2mcp.drossmedia.de` · **Betrieb:** netcup Root Server, Nürnberg, mit Cloudflare davor

> **Status:** Konzeptphase. Dieses Repository enthält derzeit ausschließlich die Konzeption. Produktivcode folgt ab Phase 1 der Roadmap.

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

## Nächste Schritte

Der kritische Pfad ist nicht der Code, sondern die **Google-OAuth-Verifizierung** für den sensitiven Scope `webmasters.readonly` — sie dauert typischerweise mehrere Wochen und setzt Domain und Datenschutzerklärung voraus. Details in [docs/02-auth.md](docs/02-auth.md) und [docs/09-roadmap.md](docs/09-roadmap.md).

Vor Phase 2 ist außerdem zu entscheiden, wohin der Bulk Data Export liefert — in das BigQuery-Projekt des Kunden oder in unseres. Die Abwägung steht in [docs/12-wettbewerb-usp.md](docs/12-wettbewerb-usp.md).
