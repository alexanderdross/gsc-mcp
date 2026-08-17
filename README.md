# GSC-MCP

Remote-MCP-Server, der die vollständigen Daten der Google Search Console in Claude verfügbar macht — mit eigenem Data Warehouse, das Googles 16-Monats-Grenze überwindet.

> **Status:** Konzeptphase. Dieses Repository enthält derzeit ausschließlich die Konzeption. Produktivcode folgt ab Phase 1 der Roadmap.

## Worum es geht

Die Search Console API ist reich an Daten, aber eng begrenzt: 16 Monate Historie, 25.000 Zeilen pro Request, rund 50.000 Zeilen pro Tag und Suchtyp. Werkzeuge, die die API nur durchreichen, erben diese Grenzen vollständig.

GSC-MCP synchronisiert die Daten stattdessen täglich in ein eigenes Warehouse. Daraus entstehen Analysen, die die Search Console selbst nicht leisten kann: Jahresvergleiche über die 16 Monate hinaus, Longtail-Auswertungen ohne Sampling, Change-Attribution bei Traffic-Einbrüchen, Kannibalisierungs-Zeitreihen und proaktive Anomalie-Erkennung.

Zielbild ist ein Produkt in zwei Stufen: zunächst für eigene Projekte, anschließend kommerziell mit Stripe-Abrechnung und Listung im Claude Connector Directory.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [00 — Konzept](docs/00-konzept.md) | Vision, Marktumfeld, Differenzierung, Zielgruppen |
| [01 — Architektur](docs/01-architektur.md) | Cloudflare-Topologie, Komponenten, Skalierungspfad |
| [02 — Auth](docs/02-auth.md) | Die zwei OAuth-Ebenen, Google-Verifizierung, Token-Handling |
| [03 — Datenmodell](docs/03-datenmodell.md) | D1-Schema als DDL, Indizes, Rollups, Volumenrechnung |
| [04 — Sync-Pipeline](docs/04-sync-pipeline.md) | Backfill, Delta-Sync, Quoten-Mathematik, Fehlerverhalten |
| [05 — Tools](docs/05-tools.md) | Die MCP-Oberfläche: Tools, Schemata, Antwortbudgets |
| [06 — Analyse-Engine](docs/06-analyse-engine.md) | Die Formeln hinter Anomalien, Attribution, CTR-Kurven |
| [07 — Billing](docs/07-billing.md) | Plan-Matrix, Stripe-Objekte, Entitlements |
| [08 — Sicherheit & DSGVO](docs/08-security-dsgvo.md) | Datenresidenz, Verschlüsselung, Löschkonzept |
| [09 — Roadmap](docs/09-roadmap.md) | Phasen 0–6, Aufwände, Risiken |
| [10 — Repo-Struktur](docs/10-repo-struktur.md) | Monorepo-Layout, Tooling |
| [11 — Go-to-Market](docs/11-go-to-market.md) | Connector Directory, Positionierung, Launch |

## Kurzüberblick Architektur

```
Claude  ──Streamable HTTP + OAuth 2.1──▶  mcp-server (Cloudflare Worker)
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                    D1 (Warehouse)     R2 (Archiv/Export)    Queues + Cron
                                                                  │
                                                                  ▼
                                                 sync-worker ──▶ Search Console API
```

## Nächste Schritte

Der kritische Pfad ist nicht der Code, sondern die **Google-OAuth-Verifizierung** für den sensitiven Scope `webmasters.readonly` — sie dauert typischerweise mehrere Wochen und muss vor allem anderen beantragt werden. Details in [docs/02-auth.md](docs/02-auth.md) und [docs/09-roadmap.md](docs/09-roadmap.md).
