# 10 — Repository-Struktur und Tooling

## Aktueller Stand

Der Baum unten ist das **Zielbild**. Umgesetzt und getestet ist bislang:

```
packages/core        ✅  Plan-Matrix, Entitlements, Metrik-Helfer
packages/analytics   ✅  Change-Attribution, CTR-Kurve (isoton)
packages/db          ✅  Drizzle-Modelle, kanonische Migration, findClickDrift(),
                          WarehouseRepo (Lesen) + WarehouseWriter (Ingest) gg. echtes PostgreSQL getestet
packages/gsc-client  ✅  Client: Pagination, Backoff, Fehlerübersetzung
apps/app             🧱  Gerüst: tool/access/budget/registry/router + alle Tool-Handler,
                          IndexingRepository (GSC-Client + DB-Cache + Budget, gg. PostgreSQL getestet),
                          MCP-Transport-Gerüst (mcp/: JSON-RPC, Zod→JSON-Schema, Dispatch, Session, /mcp-JSON-Pfad)
apps/worker          🧱  rate-limit/planner/bulk-export + ingest + sync (Backfill/Delta, Sammelposten)
                          + pg-boss-Konsument (main.ts)
```

Zwei bewusste Abweichungen vom Zielbild: Die Tool-Definitionen liegen vorerst in `apps/app/src/tools/` statt in einem eigenen `packages/mcp-tools` — solange es wenige sind, ist das näher am Router und einfacher. `packages/billing` und `apps/web` existieren noch nicht (Phase 5). Wächst die Tool-Zahl, wird `mcp-tools` herausgezogen; das ist ein reiner Verschiebeschritt.

Vom MCP-Transport und OAuth steht der netzunabhängige Kern, inklusive der HTTP-Routing-Schicht (`apps/app/src/http/`: reiner `HttpRouter` für `/mcp`, `/authorize`, `/token`, `/register`, `/.well-known/*` und den Google-Rückkanal; dünne `node:http`-Schale) und der SSE-Bausteine (`apps/app/src/mcp/sse.ts`: Ereignis-Kodierung und Keepalive-Strom, zeitgeber- und sink-injiziert, damit der 30-s-Keepalive ohne echte Uhr prüfbar ist). Offen bleibt nur noch das Netzgebundene: das Verweben von SSE und JSON-Pfad im laufenden Server, die Verdrahtung in `apps/worker` (pg-boss), die echten Google-/BigQuery-Zugänge sowie `deploy/`.

## Monorepo (Zielbild)

```
gsc-mcp/
├── apps/
│   ├── app/                 MCP-Server + OAuth Authorization Server
│   │   ├── src/
│   │   │   ├── index.ts             Hono-Einstieg, Routing, Graceful Shutdown
│   │   │   ├── oauth/               node-oidc-provider, Google-Verknüpfung, Zustimmung
│   │   │   ├── mcp/
│   │   │   │   ├── transport.ts     StreamableHTTP + SSE-Keepalive (30 s)
│   │   │   │   ├── sessions.ts      Registry, Spiegelung nach core.mcp_sessions
│   │   │   │   └── ui/              ui://-Ressourcen der MCP Apps
│   │   │   └── router.ts            Entitlement-Gate, Quota-Gate, Audit, Antwortbudget
│   │   └── Dockerfile
│   ├── worker/              Sync
│   │   ├── src/
│   │   │   ├── scheduler.ts         Job-Planung aus core.sync_state
│   │   │   ├── jobs/                Backfill · Delta · Hourly · Inspection
│   │   │   ├── limiter.ts           Token-Bucket auf core.rate_budget
│   │   │   └── maintenance.ts       Partitionen, Rollups, Parquet-Export, Beschneidung
│   │   └── Dockerfile
│   └── web/                 Landing, Dashboard, Docs, Stripe
│       ├── src/routes/
│       ├── src/webhooks/stripe.ts
│       └── Dockerfile
├── packages/
│   ├── core/                Domänentypen, Plan-Definitionen, Entitlement-Logik,
│   │                        Fehlertypen, Datums- und Zeitraumhilfen
│   ├── gsc-client/          Search-Console-Client: getippt, paginierend,
│   │                        mit Backoff und Fehlerübersetzung
│   ├── db/                  Drizzle-Schema, Migrationen, Repositories, COPY-Helfer
│   ├── analytics/           Attribution, Anomalien, CTR-Kurve, Kannibalisierung,
│   │                        Decay — reine Funktionen, keine I/O
│   ├── mcp-tools/           Tool-Definitionen: Zod-Schemata, Annotationen,
│   │                        Handler, Antwortformatierung, Prompts
│   └── billing/             Stripe-Anbindung, Webhook-Verarbeitung
├── deploy/
│   ├── compose.yaml         app · worker · web · postgres · caddy
│   ├── Caddyfile            inkl. flush_interval -1 auf /mcp
│   ├── postgres/            Tuning-Konfiguration
│   └── pgbackrest/          Backup-Konfiguration
├── docs/                    diese Konzeption
└── scripts/                 Seed, Lasttest, Wiederherstellungsübung
```

## Schnittarchitektur

Die wichtigste Grenze verläuft um `packages/analytics`: **reine Funktionen ohne Datenbankzugriff und ohne Netzwerk.** Eingabe sind Arrays von Faktenzeilen, Ausgabe sind Ergebnisobjekte. Nur so lassen sich die Formeln aus [06-analyse-engine.md](06-analyse-engine.md) gegen feste Datensätze testen, ohne eine Datenbank hochzufahren — und nur so bleiben sie nachvollziehbar.

Wo PostgreSQL die Rechnung besser erledigt als JavaScript — Median, Perzentile, Regressionssteigungen, Fensterfunktionen — liegt sie in `packages/db` als benannte Abfrage, und `analytics` bekommt das Ergebnis. Die Trennlinie ist: **SQL rechnet, TypeScript entscheidet und formuliert.**

`packages/mcp-tools` enthält keine Geschäftslogik, sondern verbindet Schema, Datenzugriff und Formatierung. Ein Tool ist damit im Wesentlichen eine Deklaration:

```ts
export const strikingDistance = defineTool({
  name: 'striking_distance',
  title: 'Striking Distance',
  annotations: { readOnlyHint: true },
  input: z.object({ /* … */ }),
  requires: { plan: 'starter', grains: ['query'] },
  async handler(ctx, input) {
    const rows = await ctx.db.strikingDistanceCandidates(ctx.propertyId, input)
    const result = analytics.rankByPotential(rows, ctx.ctrCurve, input)
    return format(result, ctx.detail)
  },
})
```

Das `requires`-Feld ist der Grund, warum Entitlement- und Mandantenprüfung zentral funktionieren: Der Router liest es aus der Registry, statt dass jeder Handler seine eigene Prüfung mitbringt und dabei einer sie vergisst.

## Technologie

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript, strict | ein Ökosystem über App, Worker und Web |
| Laufzeit | Node 22 LTS | breiteste Bibliotheksunterstützung, langer Support |
| MCP | `@modelcontextprotocol/sdk`, StreamableHTTP | offizielle Referenz |
| OAuth AS | `node-oidc-provider` | DCR, PKCE, Resource Indicators, ausgereift |
| HTTP | Hono | leichtgewichtig, gutes Typing, plattformunabhängig |
| Datenbank | PostgreSQL 17 über Drizzle | getippte Migrationen, aber roher SQL-Zugriff wo nötig |
| Queue | pg-boss | keine zusätzliche Infrastruktur |
| Validierung | Zod | zugleich Quelle der MCP-Eingabeschemata |
| Tests | Vitest, Testcontainers | echte PostgreSQL-Instanz statt Attrappe |
| Betrieb | Docker Compose, Caddy, systemd-Timer | wenige bewegliche Teile |
| CI/CD | GitHub Actions → GHCR → SSH-Deploy | kein zusätzlicher Dienst |

**Testcontainers statt In-Memory-Attrappe.** Partitionierung, `ON CONFLICT` auf partitionierten Tabellen, Abfragepläne und Trigram-Indizes verhalten sich nur in echtem PostgreSQL wie im Betrieb. Eine Attrappe würde genau die Fehler durchlassen, die später wehtun.

**Kein React im MCP-Server.** Die MCP-Apps-Oberflächen sind eigenständige HTML-Dokumente mit minimalem JavaScript. Sie laufen in einer abgeschotteten iframe und müssen klein und schnell sein; ein Framework-Bundle wäre Ballast.

## Tests

| Ebene | Umfang |
|---|---|
| Unit | `analytics` gegen feste Datensätze mit bekannten Ergebnissen; Eigenschaftstest der Attributions-Invariante |
| Integration | `gsc-client` gegen aufgezeichnete Antworten inklusive Fehler-, Quoten- und Paginierungsfällen |
| Datenbank | Migrationen, Partitionsrouting, Pruning und Upserts gegen echtes PostgreSQL |
| Abstimmung | `SUM(fact_query) = fact_totals` als Eigenschaftstest über generierte Sync-Läufe |
| Sicherheit | Mandantentrennung: iteriert über die Tool-Registry, erwartet bei fremder `property_id` einen Fehler |
| Ende zu Ende | MCP Inspector gegen die lokale Compose-Instanz; anschließend echter Claude-Client gegen `staging` **hinter dem Proxy** |

Die letzte Zeile ist keine Formalie. Lokal gibt es kein Cloudflare, also treten weder das 125-Sekunden-Limit noch das 900-Sekunden-Idle-Timeout noch Pufferung auf. SSE-Keepalive und das Rückgabeverhalten langer Operationen können deshalb **nur auf `staging`** verifiziert werden.

## Konventionen

- Deutsche Nutzertexte, englische Bezeichner im Code
- Kein `any` in öffentlichen Signaturen
- Datenzugriff ausschließlich über `packages/db`; kein SQL in Handlern
- Jedes neue Tool bringt Zod-Schema, Annotationen, `requires`, Test und einen Eintrag in [05-tools.md](05-tools.md) mit
- Migrationen vorwärtsgerichtet; Indizes auf Faktentabellen mit `CREATE INDEX CONCURRENTLY` je Partition
- Secrets ausschließlich über eingehängte Dateien; im Repository nur `.env.example`
