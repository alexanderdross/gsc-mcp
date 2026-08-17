# 01 — Architektur

## Plattformentscheidung

**netcup Root Server in Nürnberg, mit Cloudflare als vorgelagertem Proxy.** Der Server trägt Anwendung, Warehouse und Sync; Cloudflare übernimmt TLS am Rand, DDoS-Abwehr, WAF und Ratenbegrenzung.

Die ursprüngliche Planung sah Cloudflare Workers als Laufzeitumgebung vor. Diese Entscheidung wurde revidiert, nachdem Datenmodell und Analyse-Engine ausgeschrieben waren — der Engpass dieses Produkts ist die Datenbank, nicht die Runtime. Drei Gründe gaben den Ausschlag:

**1 — D1 kämpft gegen den Entwurf.** Die Analyse-Engine braucht Median, MAD, Perzentile, Regressionssteigungen und Fensterfunktionen über Monate. SQLite kennt weder `percentile_cont` noch `regr_slope`; jede dieser Funktionen müsste in JavaScript nachgebaut werden, mit allen Zeilen im Speicher. In PostgreSQL sind es Bordmittel. Dazu das Größenlimit von 10 GB je D1-Datenbank bei 2,5–4 GB pro Property und Jahr — der gesamte Shard-Apparat der Vorversion (`resolveDb`, Shard-Provisionierung, Migrationen über Shards, Größenalarme) entfällt zugunsten deklarativer Partitionierung.

**2 — Die Kosten skalieren falsch herum.** D1 rechnet nach geschriebenen Zeilen ab, und jeder Index kostet eine zusätzliche. Der tägliche Delta-Sync einer mittelgroßen Property liegt bei geschätzt ~250.000 Writes, also rund 6,8 Mio. pro Monat. Die im Paid-Plan enthaltenen 50 Mio. decken damit etwa sieben Properties; darüber kostet jede Million einen US-Dollar. Bei 150 Properties liegt allein dieser Posten bei rund 950 $/Monat, gegenüber 17 €/Monat für den gesamten Server. Bei Plänen von 19–49 € je Kunde wäre die Marge negativ. *(Schätzung mit zwei unsicheren Annahmen — Index-Verstärkung 2–3× und Zeilen pro Tag; die Größenordnung hält auch bei Faktor 3 Fehler.)*

**3 — Der Edge-Vorteil als Laufzeit ist hier keiner.** Jeder relevante Tool-Call trifft das Warehouse. Läge das Warehouse in Deutschland und der Worker nahe Claudes Infrastruktur, wäre jede Abfrage ein interkontinentaler Roundtrip — und die Analysetools setzen mehrere ab. Ein Server, der seine eigene Datenbank lokal anspricht, ist Ende zu Ende schneller.

Cloudflare fällt damit nicht weg, sondern wechselt die Rolle: vom Ausführungsort zum Schutzschild. In dieser Rolle bringt es genau das, was ein einzelner Server nicht selbst kann.

**Was das kostet:** Du betreibst die Maschine — Patches, Backups, Monitoring. Nach Einrichtung geschätzt zwei bis vier Stunden im Monat. Und der Server bleibt ein Single Point of Failure; der Weg zur Redundanz steht in [09-roadmap.md](09-roadmap.md).

## Dimensionierung

Empfehlung **RS 2000 G12**: 8 dedizierte Kerne (AMD EPYC 9645), 16 GB RAM, 512 GB NVMe, rund 17 €/Monat. Bei etwa 3 GB pro Property und Jahr trägt die Platte über 150 Property-Jahre. Faustregel: Datenbestand unter 350 GB halten, damit WAL, Vakuum-Spitzen und lokale Dumps Luft haben.

Cloudflare läuft im kostenlosen Tarif. Alles Benötigte — Proxy, TLS, WAF-Grundregeln, Ratenbegrenzung, Authenticated Origin Pulls — ist dort enthalten.

## Topologie

```
                    Claude (Web · Desktop · Code · Mobile)
                                    │
┌─────────────────────── Cloudflare (Free) ──────────────────────────────┐
│  TLS am Rand · DDoS · WAF · Rate Limiting auf /register und /token     │
│  Origin-IP verborgen · Wartungsseite bei Ausfall                        │
│  KEIN Caching auf /mcp · no-transform · SSE unverändert durchgereicht   │
└────────────────────────────────┬───────────────────────────────────────┘
              Full (strict) + Authenticated Origin Pulls (mTLS)
                                 │
╔════════════════ netcup Root Server · Nürnberg ═══════════════════════════╗
║   ufw: 443 nur aus Cloudflare-IP-Bereichen                               ║
║   ┌─────────────────────────────▼────────────────────────────────────┐   ║
║   │  Caddy — Origin-Zertifikat, Reverse Proxy                        │   ║
║   │  flush_interval -1 auf /mcp  (SSE darf nicht gepuffert werden)   │   ║
║   └───────┬──────────────────────────────────────┬──────────────────┘   ║
║           │                                      │                       ║
║   ┌───────▼────────────────────┐   ┌─────────────▼──────────────────┐   ║
║   │  app  (Node 22, Hono)      │   │  web                           │   ║
║   │                            │   │  Landing · Dashboard · Docs    │   ║
║   │  OAuth AS                  │   │  Stripe Checkout · Webhooks    │   ║
║   │   node-oidc-provider       │   └─────────────┬──────────────────┘   ║
║   │   DCR · PKCE · RFC 8707    │                 │                       ║
║   │                            │                 │                       ║
║   │  MCP /mcp                  │                 │                       ║
║   │   StreamableHTTPTransport  │                 │                       ║
║   │   SSE-Keepalive alle 30 s  │                 │                       ║
║   │   Session-Registry         │                 │                       ║
║   │                            │                 │                       ║
║   │  Tool-Router               │                 │                       ║
║   │   Entitlement · Quota      │                 │                       ║
║   │   Handler → SQL            │                 │                       ║
║   │   Antwortbudget            │                 │                       ║
║   └───────┬────────────────────┘                 │                       ║
║           │                                      │                       ║
║   ┌───────▼──────────────────────────────────────▼──────────────────┐   ║
║   │  PostgreSQL 17                                                  │   ║
║   │   Control Plane · Warehouse (Monatspartitionen)                 │   ║
║   │   pg-boss (Job-Queue)  ·  Rate-Budget (Token-Bucket)            │   ║
║   └───────▲─────────────────────────────────────────────────────────┘   ║
║           │                                                              ║
║   ┌───────┴────────────────────┐  systemd-Timer: täglich · stündlich    ║
║   │  worker  (Node 22)         │  pgBackRest → Offsite                  ║
║   │   Job-Planer               │                                         ║
║   │   Backfill · Delta · Hourly│                                         ║
║   │   GSC-Client (COPY-Bulk)   │                                         ║
║   └───────┬────────────────────┘                                        ║
╚═══════════│══════════════════════════════════════════════════════════════╝
            │
            ▼
   Google Search Console API            Offsite: Objektspeicher (EU)
                                        Backups · Parquet-Kaltarchiv
```

## Cloudflare davor — was zu beachten ist

Der Proxy bringt echten Nutzen, hat aber drei Eigenschaften, die den MCP-Transport brechen, wenn man sie übersieht. Alle drei sind billig zu beherrschen, aber keine davon ist optional.

### Die Zeitlimits

| Limit | Wert | Fehler | Konfigurierbar |
|---|---|---|---|
| Proxy **Read** Timeout | 125 s | 524 | nur Enterprise |
| Proxy **Idle** Timeout | 900 s | 520 | nein |
| Proxy **Write** Timeout | 30 s | 524 | nein |

**Read Timeout (125 s):** Der Origin muss innerhalb von 125 Sekunden *mit einer Antwort beginnen*. Für jeden Tool-Call heißt das: keine synchron durchlaufende Langoperation. `bulk_inspect_urls` etwa darf nicht 2.000 URLs im Request abarbeiten, sondern nimmt den Auftrag an, stößt einen Job an und antwortet sofort mit dem Fortschrittsverweis. Das war ohnehin der bessere Entwurf; der Proxy macht es verbindlich.

**Idle Timeout (900 s):** Fließen 15 Minuten lang keine Bytes, wird die Verbindung mit Fehler 520 abgeräumt. Der langlebige SSE-Strom des MCP-Transports tut in ruhigen Phasen genau das. **Der Server muss deshalb alle 30 Sekunden einen SSE-Kommentar (`: ping\n\n`) senden.** Ohne das reißen Sitzungen in unregelmäßigen Abständen ab — ein Fehlerbild, das sich clientseitig als sporadisches Hängen zeigt und sehr schwer zuzuordnen ist.

### Keine Transformation auf `/mcp`

Antworten tragen `Cache-Control: no-cache, no-transform`, und für den Pfad wird per Cache-Regel jedes Caching abgeschaltet. `no-transform` verhindert, dass Cloudflare den Strom umkodiert oder zwischenpuffert. Zusätzlich gehört in Caddy `flush_interval -1` an den `reverse_proxy` dieses Pfads — sonst puffert schon der lokale Proxy und der Fehler entsteht vor Cloudflare.

### Origin-Absicherung

SSL-Modus **Full (strict)** mit einem Cloudflare-Origin-Zertifikat in Caddy, dazu **Authenticated Origin Pulls** (im Free-Tarif verfügbar) und eine `ufw`-Regel, die Port 443 nur aus den Cloudflare-IP-Bereichen zulässt. Damit erreicht niemand den Server an Cloudflare vorbei, und die Origin-IP bleibt verborgen.

Die Alternative wäre ein Cloudflare Tunnel — dann entfallen eingehende Ports vollständig. Bewusst nicht gewählt, weil der Tunnel den direkten Zugang unmöglich macht, den der nächste Abschnitt braucht.

### Der unproxied Zweitname

Neben `api.gsc2mcp.com` wird ein zweiter Hostname eingerichtet, dessen DNS-Eintrag **nicht** über Cloudflare läuft und der direkt auf den Server in Nürnberg zeigt. Er löst zwei verschiedene Probleme mit einem Mittel:

- **Datenschutz.** Cloudflare terminiert TLS und verarbeitet damit personenbezogene Daten. Kunden, deren Beschaffung keinen US-Auftragsverarbeiter zulässt, bekommen den direkten Weg. Siehe [08-security-dsgvo.md](08-security-dsgvo.md).
- **Ausfall.** Ein Cloudflare-Ausfall legt den Connector lahm, obwohl der Server läuft. Der Zweitname ist der dokumentierte Notweg.

Er kostet fast nichts: derselbe Caddy, ein zusätzliches Let's-Encrypt-Zertifikat, ein A-Record ohne Proxy.

### Was der Proxy tatsächlich bringt

DDoS-Abwehr und verborgene Origin-IP für einen Server ohne Redundanz. Eine Wartungsseite, wenn der Origin nicht antwortet. Und der praktisch wertvollste Punkt: **Ratenbegrenzung am Rand auf `/register` und `/token`.** Dynamic Client Registration ist ein unauthentifizierter Endpunkt, der Datensätze anlegt — ein klassisches Missbrauchsziel. Diese Regel am Rand zu haben statt in der Anwendung bedeutet, dass eine Missbrauchswelle den Server gar nicht erst erreicht.

## Komponenten

### Caddy

Reverse Proxy und Zertifikatsverwaltung: Cloudflare-Origin-Zertifikat für den proxied Hostnamen, Let's Encrypt für den direkten. Route auf `/mcp` mit `flush_interval -1`, alles Übrige normal.

### app — MCP-Server und OAuth Authorization Server

Node 22 LTS, TypeScript, Hono.

**OAuth AS** über `node-oidc-provider`. Es deckt ab, was der Remote-MCP-Anschluss verlangt: Dynamic Client Registration (RFC 7591), PKCE, Resource Indicators (RFC 8707) und die Metadata-Endpunkte. Gegenüber Cloudflares fertiger Bibliothek mehr Konfiguration, aber kein neues Risiko — die Bibliothek ist ausgereift und weit im Einsatz. Details in [02-auth.md](02-auth.md).

**MCP-Endpunkt** über `StreamableHTTPServerTransport` aus dem offiziellen SDK, mit dem oben beschriebenen Keepalive.

**Sitzungszustand.** In der Cloudflare-Variante hielt ein Durable Object je Sitzung den Property-Kontext. Hier genügt eine Registry im Prozess, die nach `Mcp-Session-Id` schlüsselt und den Kontext zusätzlich in `mcp_sessions` schreibt, damit ein Neustart laufende Sitzungen nicht verliert. Weniger Apparat, gleiches Verhalten.

### worker — Sync

Eigener Prozess, weil die Anforderungen gegensätzlich sind: Der MCP-Server muss in Millisekunden antworten, ein Backfill läuft stundenlang und darf scheitern und wiederholen. Getrennte Prozesse heißen auch, dass ein aus dem Ruder laufender Sync die Interaktivität nicht mitreißt.

**Job-Queue: pg-boss** in derselben PostgreSQL-Instanz — kein zusätzlicher Dienst, Jobs transaktional konsistent mit den Daten, Zustand mit normalem SQL einsehbar. Für dieses Volumen wären Redis oder RabbitMQ unnötiger Betriebsaufwand.

**Zeitsteuerung: systemd-Timer.** Idempotent aktivierbar, protokollieren ins Journal, einzeln nachfahrbar.

**Rate-Limiter.** In der Cloudflare-Variante brauchte es dafür ein Durable Object, weil ein global serialisierter Singleton fehlte. Hier ist der Token-Bucket eine kleine Tabelle mit `SELECT … FOR UPDATE`: korrekt, nachvollziehbar, rund vierzig Zeilen. Zwingend bleibt er trotzdem — die Search-Console-Quoten gelten pro Google-Cloud-Projekt und damit geteilt über alle Kunden ([04-sync-pipeline.md](04-sync-pipeline.md)).

### web — Landingpage, Dashboard, Stripe

Eigener Prozess hinter demselben Caddy. Beherbergt drei Seiten, die für Directory-Listung und Google-Verifizierung **zwingend** sind: öffentliche Datenschutzerklärung, öffentliche Dokumentation, Support-Kontakt ([11-go-to-market.md](11-go-to-market.md)).

### PostgreSQL 17

Trägt vier Aufgaben in einer Instanz: Control Plane, Warehouse, Job-Queue, Rate-Budget. Getrennte Schemas, ein Betriebsobjekt.

Ausgangswerte für 16 GB RAM, vor Produktivgang an echten Abfragen nachzujustieren:

```
shared_buffers                  = 4GB
effective_cache_size            = 12GB
work_mem                        = 64MB     # Analysen sortieren viel
maintenance_work_mem            = 1GB      # Index-Aufbau, VACUUM
max_parallel_workers            = 8
max_parallel_workers_per_gather = 4
random_page_cost                = 1.1      # NVMe, kein Spindelaufschlag
wal_compression                 = zstd
```

**Kein Redis.** Was zwischengespeichert werden muss — Google-Access-Tokens, aufgelöste Entitlements — passt in einen prozesslokalen LRU-Cache mit kurzer Gültigkeit. Bei einem einzigen Anwendungsknoten löst Redis ein Problem, das nicht existiert. Beim Übergang auf mehrere Knoten kommt es dazu, nicht vorher.

## Warehouse-First mit Live-Fallback

Unabhängig von der Plattform und deshalb unverändert:

```
Anfrage
  │
  ├─ Zeitraum vollständig im Warehouse gedeckt?  ──ja──▶  SQL
  │
  ├─ Teilweise gedeckt?  ──▶  SQL für den gedeckten Teil
  │                           + Live-Call für die Lücke
  │                           + Hinweis, welcher Teil woher stammt
  │
  └─ Nicht gedeckt (Backfill läuft, Free-Plan)?  ──▶  Live-Call,
                                                      Google-Limits gelten
```

Die Deckung ergibt sich aus `sync_state` je Property und Grain. Der Nutzer muss erkennen können, ob eine Zahl aus dem eigenen Archiv oder live von Google stammt — sonst wirken Antworten während eines laufenden Backfills unerklärlich unvollständig.

Live-Calls aus dem `app`-Prozess buchen ihr Kontingent über dieselbe Rate-Budget-Tabelle wie der Worker, mit höherer Priorität. Ein wartender Nutzer geht immer vor einem Hintergrundauftrag.

## Betrieb

| Belang | Umsetzung |
|---|---|
| Betriebssystem | Debian stable, `unattended-upgrades` für Sicherheitsaktualisierungen |
| Prozesse | Docker Compose (`app`, `worker`, `web`, `postgres`, `caddy`) |
| Deployment | GitHub Actions baut Images, pusht in die GitHub Container Registry, SSH-Deploy zieht und startet neu |
| Migrationen | laufen beim Start von `app`, bevor der Port geöffnet wird |
| Backups | pgBackRest: wöchentlich voll, täglich inkrementell, WAL-Archivierung für Point-in-Time-Recovery, offsite in EU-Objektspeicher |
| Monitoring | Prometheus mit `postgres_exporter` und `node_exporter`, Grafana lokal |
| Verfügbarkeitsprüfung | **extern**, und zwar auf beiden Hostnamen — proxied und direkt |
| Härtung | SSH nur mit Schlüssel, Root-Login aus, `ufw` erlaubt 443 nur aus Cloudflare-Bereichen plus SSH, `fail2ban`, PostgreSQL bindet ausschließlich auf localhost |

Zwei Zeilen verdienen Nachdruck. Die **externe** Verfügbarkeitsprüfung ist der einzige Weg, einen Ausfall zu bemerken, bevor ein Kunde ihn meldet — eine Überwachung, die mit dem Überwachten ausfällt, meldet nie etwas. Und sie muss **beide** Hostnamen prüfen: Nur so lässt sich ein Cloudflare-Problem von einem Server-Problem unterscheiden, was im Störungsfall die erste und wichtigste Frage ist.

## Skalierungspfad

1. **Ein Server.** Trägt die absehbare Kundenzahl. Aufrüstung durch größeren RS.
2. **Datenbank trennen.** Ein zweiter RS nur für PostgreSQL. Verdoppelt die CPU für Analysen.
3. **Warm Standby.** Streaming-Replikation auf einen zweiten Server, Umschaltung über Cloudflare-Load-Balancing oder DNS. Beseitigt den Single Point of Failure — Voraussetzung dafür, Verfügbarkeit vertraglich zuzusagen.
4. **Kaltarchiv auslagern.** Tagesfakten älter als 24 Monate als Parquet in den Objektspeicher, Monats-Rollups bleiben in PostgreSQL. Mehrjahresvergleiche funktionieren weiter ohne Zugriff auf das Archiv.

Stufe 3 ist die einzige, die vor dem kommerziellen Start bedacht werden muss — nicht zwingend gebaut, aber bepreist und in den AGB abgebildet.

## Umgebungen

| Umgebung | Zweck | Besonderheit |
|---|---|---|
| `dev` | lokal | Docker Compose, PostgreSQL im Container, GSC-Calls gegen echten Testaccount, kein Cloudflare |
| `staging` | Vorabprüfung, Directory-Review | zweite Compose-Instanz auf demselben Server, eigene Datenbank, eigenes GCP-OAuth-Projekt, Stripe-Testmodus |
| `production` | Live | eigene Domain, Cloudflare proxied plus direkter Zweitname, Stripe-Livemodus |

Dass `dev` ohne Cloudflare läuft, ist bequem und zugleich eine Falle: Die Timeout- und Puffer-Eigenschaften des Proxys treten dort nie auf. Der SSE-Keepalive und das Rückgabeverhalten langer Operationen gehören deshalb **auf `staging` hinter dem echten Proxy** geprüft, nicht nur lokal.

Staging auf demselben Server zu fahren ist eine bewusste Sparmaßnahme und für diese Größenordnung vertretbar. Es ist keine Kür: Für die Directory-Einreichung wird ein Testzugang mit realistischen Beispieldaten verlangt, den ein Prüfer ohne Vorkenntnisse in zehn Minuten bedienen kann.
