# CLAUDE.md

Leitfaden für die Arbeit an diesem Repository. Kurz halten, an der Realität ausrichten.

## Was das ist

Remote-MCP-Server, der Google-Search-Console-Daten in KI-Assistenten (Claude, ChatGPT, Cursor) verfügbar macht — auf Basis von **Googles vollständigem Bulk Data Export** statt der limitierten API. Zunächst für eigene Projekte, später kommerziell mit Stripe. Die vollständige Konzeption liegt in `docs/` (13 Dokumente, Einstieg über `README.md`).

**Domain:** `gsc2mcp.drossmedia.de` (Subdomain der bestehenden Cloudflare-Zone). **Betrieb:** netcup Root Server, Nürnberg, Cloudflare als Proxy davor.

## Architektur in einem Absatz

Ein einzelner Server trägt Anwendung (`apps/app`: MCP + OAuth-AS), Sync (`apps/worker`) und PostgreSQL 17 (Warehouse mit Monatspartitionen, pg-boss als Queue, Rate-Budget). Cloudflare terminiert TLS und schützt, führt aber **keinen** Code aus — die frühere Cloudflare-Workers-Variante wurde verworfen, weil der Engpass die Datenbank ist, nicht die Runtime (`docs/01`). Datenbeschaffung ist zweistufig: einmaliger API-Backfill über 16 Monate, danach der Bulk Export (vollständig, ohne API-Quote) aus dem BigQuery-Projekt des Kunden.

## Struktur

```
packages/core        Plan-Matrix, Entitlements, Metrik-Grundregeln
packages/analytics   Change-Attribution, CTR-Kurve — reine Funktionen, keine I/O
packages/db          Drizzle-Modelle + kanonische Migration + Repositories
packages/gsc-client  Search-Console-Client (Pagination, Backoff, Fehler)
apps/app             MCP-Server: Registry, Router, Gates (Gerüst)
apps/worker          Sync: Rate-Limiter, Planung, Bulk-Export (Gerüst)
docs/                Konzeption (00–12) + uebersicht.html (Artefakt)
scripts/             validate-ddl.mjs, check-docs.mjs, render-check.mjs
```

## Befehle

```bash
npm run typecheck   # tsc --build (Projektreferenzen)
npm test            # Vitest, packages/*/test + apps/*/test
node scripts/check-docs.mjs           # Doku-Links, Konsistenz, Artefakt-Struktur
PGURL=… node scripts/validate-ddl.mjs # Migration gegen echtes PostgreSQL
```

## Konventionen (aus `docs/10`)

- **Deutsche Nutzertexte, englische Bezeichner im Code.** Kommentare deutsch.
- TypeScript strict, kein `any` in öffentlichen Signaturen (in `apps/app` gibt es genau eine bewusste, kommentierte Ausnahme: `AnyTool.handler`).
- Imports mit `.ts`-Endung (`allowImportingTsExtensions`, `emitDeclarationOnly`).
- **Datenzugriff ausschließlich über `packages/db`** — kein rohes SQL in Handlern.
- **Reine Analyse in `packages/analytics`** — keine Datenbank, keine Netzwerkaufrufe; so bleiben die Formeln aus `docs/06` testbar.
- **Berechtigung und Mandantentrennung zentral im Router**, nie im einzelnen Handler (`docs/08`). Jedes neue Tool bringt Zod-Schema, Annotationen (`readOnlyHint`/`destructiveHint`), `requires`, einen Test und einen Eintrag in `docs/05` mit.
- Kanonische DDL ist die Migration, nicht die Doku. Schema-Änderungen: Migration anpassen, `docs/03` nachziehen, Drizzle-Modelle in `packages/db/src/schema.ts` angleichen (ein Test erzwingt die Übereinstimmung).

## Invarianten, die nicht brechen dürfen

- **`SUM(fact_query) = fact_totals`** je Tag (`docs/03`). Der Sammelposten `query_id = 0` fängt Googles anonymisierte Anfragen; ohne ihn werden Segmentanteile still falsch. `findClickDrift()` und ein CI-Test wachen darüber.
- **Change-Attribution summiert sich exakt** zu `Δclicks` (`docs/06`). Eigenschaftstests sichern das ab.
- **Position impressionsgewichtet**, nie als Mittelwert von Mittelwerten. CTR nie gespeichert, immer berechnet.

## Was NICHT autonom passiert

Externe Infrastruktur mit realen Nebenwirkungen — Cloudflare-DNS anlegen, GCP-OAuth-Client, Google-Verifizierung, netcup-Server, Stripe scharf schalten. Diese Schritte gehören dem Betreiber; hier nur vorbereiten und dokumentieren.

## Kritischer Pfad

Die **Google-OAuth-Verifizierung** für den sensitiven Scope `webmasters.readonly` dauert Wochen und setzt Domain + Datenschutzerklärung voraus (`docs/02`, `docs/09`). Sie ist der längste Pfad zum kommerziellen Start — früh anstoßen, nicht ans Ende legen.

## Git

Entwicklung auf `claude/loving-rubin-64k8jm`, PRs gegen `main`, Merge bei grüner CI. Ein Commit je kohärentem Schritt; Commit-Botschaften erklären das Warum.
