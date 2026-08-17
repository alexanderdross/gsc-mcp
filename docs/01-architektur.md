# 01 — Architektur

## Überblick

```
                        Claude (Web · Desktop · Code · Mobile)
                                      │
                    Streamable HTTP + OAuth 2.1 (PKCE, DCR, RFC 8707)
                                      │
┌─────────────────────────────── Worker: mcp-server ───────────────────────────────┐
│                                                                                   │
│  /.well-known/*  ·  /register  ·  /authorize  ·  /token   ← OAuth AS              │
│         │                                                                         │
│         ▼                                                                         │
│  /mcp  →  McpAgent (Durable Object je Session)                                    │
│              │  hält: user_id, gewählte Property, Präferenzen                     │
│              ▼                                                                    │
│           Tool-Router                                                             │
│              ├─ Entitlement-Gate  (Plan aus D1, Cache in KV)                      │
│              ├─ Quota-Gate        (Zähler in D1, Fenster in KV)                   │
│              ├─ Handler           (liest D1-Warehouse, Fallback GSC-API live)     │
│              └─ Response-Budget   (Kürzung + expliziter Hinweis)                  │
│                                                                                   │
│  MCP Resources (Property-Metadaten) · MCP Prompts · MCP Apps (ui://)              │
└───────────────────────────────────────────────────────────────────────────────────┘
      │                    │                   │                    │
      ▼                    ▼                   ▼                    ▼
  D1 (Control)      D1 (Warehouse,        R2 (Parquet-Archiv,   KV (Token-Cache,
                     ggf. geshardet)       Exporte)              Entitlements)
                          ▲                     ▲
                          │                     │
                    ┌─────┴─────────────────────┴────────────────────┐
                    │           Worker: sync-worker                   │
                    │  Cron (täglich · stündlich) → Queue-Producer    │
                    │  Queue-Consumer → GSC-API → Upsert D1           │
                    │  Rate-Limiter (Durable Object, Token-Bucket)    │
                    └────────────────────────┬───────────────────────┘
                                             ▼
                                Google Search Console API

┌─────────────────────── Worker: web ───────────────────────┐
│  Landingpage · Dashboard · Stripe Checkout/Portal          │
│  /webhooks/stripe  (Signaturprüfung, idempotent)           │
│  Datenschutz · AGB · Docs (Pflicht fürs Directory)         │
└───────────────────────────────────────────────────────────┘
```

## Komponenten und ihre Begründung

### mcp-server (Worker)

Der einzige Endpunkt, den Claude kennt. Er vereint drei Rollen:

**OAuth Authorization Server.** Claude spricht MCP-Server nicht mit statischen API-Keys an, sondern über OAuth 2.1 mit Dynamic Client Registration — der Client registriert sich selbst. Cloudflares `@cloudflare/workers-oauth-provider` implementiert das Nötige und legt Grants und Tokens in KV ab. Details in [02-auth.md](02-auth.md).

**MCP-Endpunkt über Streamable HTTP.** Der frühere HTTP+SSE-Transport ist abgelöst; Streamable HTTP arbeitet mit einem einzigen Endpunkt und funktioniert hinter Load Balancern und Proxies. Protokollversion und Session-Handling folgen der jeweils aktuellen Spezifikation.

**Session-Zustand im Durable Object.** Der `McpAgent` aus dem `agents`-SDK gibt jeder Sitzung ein eigenes Durable Object. Dort liegt die gewählte Property. Das ist der Grund, warum `select_property` überhaupt funktioniert: Ohne Sitzungszustand müsste jeder einzelne Tool-Call die Property mitschleppen, was den Agenten Tokens kostet und Fehler provoziert. Der Wettbewerber nutzt dasselbe Muster.

### sync-worker (Worker)

Getrennt vom MCP-Server, weil die Anforderungen gegensätzlich sind: Der MCP-Server muss in Millisekunden antworten, der Sync läuft minutenlang und darf scheitern und wiederholen.

**Cron Triggers** stoßen an, **Queues** entkoppeln. Ein 16-Monats-Backfill sind je nach Grain mehrere tausend API-Calls — das passt in kein Request-Zeitfenster und muss als Auftragsstrom laufen, der Unterbrechungen übersteht.

**Der Rate-Limiter ist ein eigenes Durable Object und nicht verhandelbar.** Die Quoten der Search Console API gelten unter anderem **pro Google-Cloud-Projekt** — also geteilt über alle unsere Kunden hinweg. Ohne zentrale Drosselung reißt der Backfill eines einzigen großen Neukunden die Quote für alle anderen. Ein Durable Object ist per Definition ein Singleton mit serialisiertem Zugriff und damit die korrekte Stelle für einen globalen Token-Bucket. Details in [04-sync-pipeline.md](04-sync-pipeline.md).

### Datenhaltung

**D1 (SQLite)** trägt zwei getrennte Aufgaben:

- *Control Plane* — Nutzer, Properties, Credentials, Abos, Quoten, Sync-Zustand, Audit-Log. Klein, transaktional, eine Datenbank für alle Mandanten mit `user_id`-Filterung.
- *Warehouse* — die Faktentabellen. Groß, schreibintensiv, primär analytische Leseabfragen.

**R2** ist Kaltarchiv und Export-Kanal: monatliche Parquet-Dateien je Property (billiger als D1, ideal für Wiederherstellung und externe Weiterverarbeitung) sowie Nutzer-Exporte über präsignierte URLs mit kurzer Gültigkeit.

**KV** cacht, was oft gelesen und selten geschrieben wird: aktive Google-Access-Tokens (bis kurz vor Ablauf), aufgelöste Entitlements, OAuth-Grants.

### web (Worker)

Landingpage, Kunden-Dashboard, Stripe-Checkout und -Webhooks. Zusätzlich beherbergt er drei Seiten, die für die Listung im Claude Connector Directory **zwingend** sind: öffentliche Datenschutzerklärung, öffentliche Dokumentation und Support-Kontakt. Siehe [11-go-to-market.md](11-go-to-market.md).

## Skalierungspfad

D1 hat ein Größenlimit pro Datenbank (Planungsannahme: 10 GB — vor Umsetzung gegen die aktuelle Cloudflare-Dokumentation prüfen). Eine große Property kann auf vollem Grain in diese Größenordnung wachsen, siehe Volumenrechnung in [03-datenmodell.md](03-datenmodell.md).

Der Plan sieht das von Anfang an vor, ohne es sofort zu bauen:

1. **Stufe 1 — eine Warehouse-D1 für alle.** Ausreichend für die ersten Kunden. Die Spalte `properties.database_id` existiert bereits, steht aber auf dem Default.
2. **Stufe 2 — Sharding je Property.** Überschreitet eine Property einen Schwellwert, wird per Cloudflare-API eine eigene D1 provisioniert und `database_id` umgesetzt. Der Datenzugriff läuft ausschließlich über eine `resolveDb(propertyId)`-Funktion, sodass kein Handler angefasst werden muss.
3. **Stufe 3 — Notausgang Postgres.** Für Volumen jenseits von D1: Hyperdrive vor einer Postgres-Instanz. Deshalb bleibt das Datenmodell portabel — reines SQL, Drizzle-Migrationen, keine SQLite-Spezifika in Geschäftslogik.

Diese Reihenfolge ist bewusst: Stufe 1 kostet nichts an Komplexität, Stufe 2 ist ein Tagesprojekt, wenn `resolveDb` von Beginn an existiert, und Stufe 3 wird realistisch nie gebraucht.

## Warehouse-First mit Live-Fallback

Jeder Performance-Handler folgt derselben Entscheidung:

```
Anfrage
  │
  ├─ Ist der Zeitraum vollständig im Warehouse gedeckt?  ──ja──▶  D1-Query
  │
  ├─ Teilweise gedeckt?  ──▶  D1 für den gedeckten Teil
  │                           + Live-Call für die Lücke
  │                           + Hinweis im Output, welcher Teil woher stammt
  │
  └─ Nicht gedeckt (z. B. Backfill läuft noch, Free-Plan)?  ──▶  Live-Call,
                                                                 Google-Limits gelten
```

Die Deckung ergibt sich aus `sync_state` je Property und Grain. Entscheidend ist die Transparenz: Der Nutzer muss erkennen können, ob eine Zahl aus dem eigenen Archiv oder live von Google stammt — insbesondere während eines laufenden Backfills, wo Antworten sonst unerklärlich unvollständig wirken.

Live-Fallback ist außerdem der Free-Plan-Modus: Ohne Sync gibt es kein Warehouse, also arbeitet der Server dort wie ein klassischer Passthrough — funktionsfähig, aber mit Googles Grenzen, was zugleich das ehrlichste Upgrade-Argument ist.

## Umgebungen

| Umgebung | Zweck | Besonderheit |
|---|---|---|
| `dev` | lokal via `wrangler dev` | Miniflare-D1, GSC-Calls gegen echten Testaccount |
| `staging` | Vorabprüfung, Directory-Review | eigenes GCP-OAuth-Projekt, Stripe-Testmodus, Demo-Daten |
| `production` | Live | EU-Datenresidenz, Stripe-Livemodus |

Das Staging-System ist keine Kür: Für die Directory-Einreichung wird ein Testzugang mit realistischen Beispieldaten verlangt, den ein Reviewer ohne Vorkenntnisse in zehn Minuten bedienen kann.
