# Deployment-Runbook

Konkrete Schritte, um GSC-MCP auf dem netcup Root Server hinter Cloudflare zu betreiben. Umsetzung von [docs/01-architektur.md](../docs/01-architektur.md); DNS/Cloudflare im Detail in [dns.md](dns.md), Auth in [docs/02-auth.md](../docs/02-auth.md).

> Die mit **(Betreiber)** markierten Schritte haben reale Nebenwirkungen oder brauchen externe Zugänge (GCP, netcup, Cloudflare, Google-Verifizierung) und werden nicht automatisiert ausgeführt.

## Überblick

```
Claude ──HTTPS──▶ Cloudflare (proxied) ──▶ Caddy (TLS, Origin-Pulls) ──▶ app:8080
                                                                          │
                                                     PostgreSQL 17 ◀──────┘
gsc2mcp-direct  ──HTTPS──▶ Caddy (Let's Encrypt) ──▶ app:8080   (Direktweg)
```

## 1. Server vorbereiten (Betreiber)

1. netcup Root Server bestellen, aktuelles Debian/Ubuntu. Öffentliche IPv4 (und IPv6) notieren → das ist `<ORIGIN_IP>` aus [dns.md](dns.md).
2. Docker + Compose-Plugin installieren (oder Node 22 + PostgreSQL 17 für den systemd-Weg).
3. Repository nach `/opt/gsc-mcp` klonen.

## 2. Secrets und Konfiguration

1. `.env` aus [`.env.example`](../.env.example) erzeugen.
2. Verschlüsselungsschlüssel setzen: `openssl rand -base64 32` → `ENCRYPTION_KEY`. **Sichern** — geht er verloren, sind die abgelegten Google-Refresh-Tokens unbrauchbar.
3. `POSTGRES_PASSWORD` setzen; `DATABASE_URL` passt Compose intern an.
4. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` aus Schritt 4 eintragen.

## 3. Starten

**Docker (empfohlen):**

```bash
docker compose up -d --build          # Postgres + app
docker compose exec -e DATABASE_URL=postgres://gscmcp:$POSTGRES_PASSWORD@localhost:5432/gscmcp \
  app node scripts/migrate.mjs        # Schema anlegen
```

**systemd (ohne Docker):** PostgreSQL bereitstellen, `DATABASE_URL=… node scripts/migrate.mjs` ausführen, dann [`gsc-mcp.service`](gsc-mcp.service) nach `/etc/systemd/system/` kopieren und `systemctl enable --now gsc-mcp`.

## 4. Google OAuth (Betreiber, kritischer Pfad)

Der sensitive Scope `webmasters.readonly` verlangt eine Verifizierung, die **Wochen** dauert — früh anstoßen ([docs/02](../docs/02-auth.md), [docs/09](../docs/09-roadmap.md)).

1. GCP-Projekt anlegen, OAuth-Consent-Screen (extern) konfigurieren, Datenschutzerklärung auf der verifizierten Domain verlinken.
2. OAuth-Client (Webanwendung) erstellen; autorisierte Redirect-URI: `https://gsc2mcp.drossmedia.de/oauth/google/callback`. Client-ID/Secret in `.env`.
3. Verifizierung für den sensitiven Scope beantragen (Demo-Video, Scope-Begründung, Brand-Verifizierung).

## 5. Cloudflare und TLS (Betreiber)

1. DNS-Records und SSL-Modus nach [dns.md](dns.md) (proxied `gsc2mcp`, DNS-only `gsc2mcp-direct`, Full strict, Origin-Zertifikat, Authenticated Origin Pulls).
2. Origin-Zertifikat/-Schlüssel und die Cloudflare-Origin-Pull-CA nach `/etc/caddy/` legen (Pfade in [`Caddyfile`](Caddyfile)).
3. Caddy mit [`Caddyfile`](Caddyfile) starten. Die Cache-Regel für `/mcp` (kein Caching, `flush_interval -1`) ist zwingend — sonst bricht der SSE-Transport.

## 6. Prüfen

```bash
curl https://gsc2mcp.drossmedia.de/.well-known/oauth-protected-resource   # Metadaten
curl https://gsc2mcp.drossmedia.de/.well-known/oauth-authorization-server
```

Danach den MCP-Server in Claude als Remote-Connector eintragen (`https://gsc2mcp.drossmedia.de/mcp`) und den OAuth-Fluss durchlaufen. Der SSE-Keepalive und das Verhalten langer Operationen gehören **hinter dem echten Proxy** geprüft, nicht nur lokal ([docs/01](../docs/01-architektur.md)).

## Sync-Worker

Der Worker (`apps/worker`) konsumiert die pg-boss-Queue und führt die Massen-Inspektionen aus. Unter Docker läuft er als eigener `worker`-Dienst (`docker compose up -d` startet ihn mit); ohne Docker über [`gsc-mcp-worker.service`](gsc-mcp-worker.service) bzw. `npm run start:worker`. pg-boss legt sein Schema beim ersten Start selbst an.

## Noch offen

- **Backfill/Delta-Planung und BigQuery-Bulk-Export** im Worker verdrahten (die reinen Bausteine — Planer, Rate-Limiter, Ingest-Aggregation — stehen).
- **BigQuery-Dienstkonto** je Kunde mit `bigquery.dataViewer` auf dem Export-Dataset (Betreiber/Kunde).
