# 10 — Repository-Struktur und Tooling

## Monorepo

```
gsc-mcp/
├── apps/
│   ├── mcp-server/          Worker: OAuth AS + MCP-Endpunkt
│   │   ├── src/
│   │   │   ├── index.ts             Einstieg, Routing
│   │   │   ├── oauth/               AS-Endpunkte, Google-Verknüpfung, Zustimmung
│   │   │   ├── agent.ts             McpAgent (Durable Object), Sitzungszustand
│   │   │   ├── router.ts            Entitlement-Gate, Quota-Gate, Audit, Budget
│   │   │   └── ui/                  ui://-Ressourcen der MCP Apps
│   │   └── wrangler.toml
│   ├── sync-worker/         Worker: Cron, Queue-Consumer, Rate-Limiter-DO
│   │   ├── src/
│   │   │   ├── scheduler.ts         Job-Planung aus sync_state
│   │   │   ├── consumer.ts          Queue-Verarbeitung, Pagination, Upsert
│   │   │   ├── limiter.ts           Durable Object, Token-Bucket, drei Ebenen
│   │   │   └── maintenance.ts       Rollups, Parquet-Export, Beschneidung
│   │   └── wrangler.toml
│   └── web/                 Worker: Landing, Dashboard, Stripe
│       ├── src/
│       │   ├── routes/
│       │   └── webhooks/stripe.ts
│       └── wrangler.toml
├── packages/
│   ├── core/                Domänentypen, Plan-Definitionen, Entitlement-Logik,
│   │                        Fehlertypen, Datums- und Zeitraumhilfen
│   ├── gsc-client/          Search-Console-API-Client: getippt, paginierend,
│   │                        mit Backoff und Fehlerübersetzung
│   ├── db/                  Drizzle-Schema, Migrationen, resolveDb(), Repositories
│   ├── analytics/           Attribution, Anomalien, CTR-Kurve, Kannibalisierung,
│   │                        Decay — reine Funktionen, keine I/O
│   ├── mcp-tools/           Tool-Definitionen: Zod-Schemata, Annotationen,
│   │                        Handler, Antwortformatierung, Prompts
│   └── billing/             Stripe-Anbindung, Webhook-Verarbeitung
├── docs/                    diese Konzeption
└── scripts/                 Migrationslauf über alle Shards, Seed, Lasttest
```

## Schnittarchitektur

Die wichtigste Grenze verläuft um `packages/analytics`: **reine Funktionen ohne Datenbankzugriff und ohne Netzwerk.** Eingabe sind Arrays von Faktenzeilen, Ausgabe sind Ergebnisobjekte. Nur so lassen sich die Formeln aus [06-analyse-engine.md](06-analyse-engine.md) gegen feste Datensätze testen, ohne eine Datenbank hochzufahren — und nur so bleiben sie nachvollziehbar.

`packages/mcp-tools` enthält keine Geschäftslogik, sondern verbindet Schema, Datenzugriff und Formatierung. Ein Tool ist damit im Wesentlichen eine Deklaration:

```ts
export const strikingDistance = defineTool({
  name: 'striking_distance',
  title: 'Striking Distance',
  annotations: { readOnlyHint: true },
  input: z.object({ /* … */ }),
  requires: { plan: 'starter', grains: ['query'] },
  async handler(ctx, input) {
    const rows = await ctx.db.queryFacts(/* … */)
    const result = analytics.strikingDistance(rows, ctx.ctrCurve, input)
    return format(result, ctx.detail)
  },
})
```

Das `requires`-Feld ist der Grund, warum das Entitlement-Gate zentral funktionieren kann: Der Router liest es aus der Registry, statt dass jeder Handler seine eigene Prüfung mitbringt und dabei einer sie vergisst.

## Technologie

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript, strict | ein Ökosystem über Worker, Sync und Web |
| MCP | `@modelcontextprotocol/sdk` + `agents` (`McpAgent`) | Sitzungszustand im Durable Object |
| OAuth | `@cloudflare/workers-oauth-provider` | DCR, PKCE, Token-Rotation fertig |
| HTTP | Hono | leichtgewichtig, Workers-nativ |
| Datenbank | Drizzle ORM auf D1 | getippte Migrationen, portables SQL |
| Validierung | Zod | zugleich Quelle der MCP-Eingabeschemata |
| Tests | Vitest, `@cloudflare/vitest-pool-workers` | Tests laufen in der echten Worker-Umgebung |
| Deployment | Wrangler, GitHub Actions | – |

**Kein React im MCP-Server.** Die MCP-Apps-Oberflächen sind eigenständige HTML-Dokumente mit minimalem JavaScript. Sie laufen in einer abgeschotteten iframe und müssen klein und schnell sein; ein Framework-Bundle wäre hier reiner Ballast.

## Tests

| Ebene | Umfang |
|---|---|
| Unit | `analytics` gegen feste Datensätze mit bekannten Ergebnissen; Eigenschaftstest der Attributions-Invariante |
| Integration | `gsc-client` gegen aufgezeichnete Antworten inklusive Fehler- und Paginierungsfällen |
| Datenbank | Migrationen und Repositories gegen Miniflare-D1 |
| Sicherheit | Mandantentrennung: iteriert über die Tool-Registry und erwartet bei fremder `property_id` einen Fehler |
| Ende zu Ende | MCP Inspector gegen `wrangler dev`; anschließend echter Claude-Client gegen `staging` |

Der Mandantentrennungs-Test iteriert bewusst über die Registry statt über eine gepflegte Liste — so ist ein neu hinzugefügtes Tool automatisch abgedeckt, auch wenn niemand daran denkt.

## Konventionen

- Deutsche Nutzertexte, englische Bezeichner im Code
- Kein `any` in öffentlichen Signaturen
- Datenzugriff ausschließlich über `packages/db`; kein SQL in Handlern
- Jedes neue Tool bringt Zod-Schema, Annotationen, `requires`, Test und einen Eintrag in [05-tools.md](05-tools.md) mit
- Migrationen sind vorwärtsgerichtet und laufen über alle Shards
- Secrets ausschließlich über Wrangler; im Repository nur `.dev.vars.example`
