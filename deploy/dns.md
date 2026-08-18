# DNS und Cloudflare-Setup

Konkrete, anwendbare Schritte für die Zone `drossmedia.de` im Cloudflare-Account **„Dross:Media"**. Umsetzung von [docs/01-architektur.md](../docs/01-architektur.md) und [docs/08-security-dsgvo.md](../docs/08-security-dsgvo.md).

> **Voraussetzung:** Die öffentliche IP des netcup Root Servers (`<ORIGIN_IP>`, ggf. zusätzlich `<ORIGIN_IPV6>`). Ohne laufenden Origin keine Records anlegen — ein proxied Eintrag auf einen toten Origin liefert nur Fehlerseiten.
>
> **Hinweis zum Tooling:** Der Cloudflare-Connector dieser Umgebung verwaltet Workers/D1/KV/R2/Hyperdrive, **nicht** DNS. Die folgenden Schritte werden im Cloudflare-Dashboard oder per API/Terraform ausgeführt.

## 1. DNS-Records

| Typ | Name | Ziel | Proxy | Zweck |
|---|---|---|---|---|
| A | `gsc2mcp` | `<ORIGIN_IP>` | **Proxied** (orange) | Web, MCP (`/mcp`), OAuth — pfadgeroutet |
| A | `gsc2mcp-direct` | `<ORIGIN_IP>` | **DNS only** (grau) | EU-Direktweg ohne US-Proxy, Notweg bei CF-Ausfall |

Bei IPv6 je ein zusätzlicher `AAAA`-Record mit denselben Namen und Proxy-Einstellungen.

**Warum ein proxied Host statt `www`/`api`:** Cloudflares kostenloses Universal-SSL deckt nur die erste Subdomain-Ebene (`*.drossmedia.de`). `api.gsc2mcp.drossmedia.de` wäre die zweite Ebene und kostenpflichtig. Pfad-Routing auf einem Host löst das für null Euro; `gsc2mcp-direct` bleibt auf der ersten Ebene und ist vom Wildcard gedeckt.

## 2. SSL/TLS

- Modus **Full (strict)** für die Zone (oder per Configuration Rule auf die beiden Hostnamen begrenzt, falls andere Zonen-Hosts einen anderen Modus brauchen).
- **Origin-Zertifikat** in Cloudflare erzeugen (SSL/TLS → Origin Server), in Caddy für `gsc2mcp.drossmedia.de` hinterlegen.
- **Authenticated Origin Pulls** aktivieren (SSL/TLS → Origin Server → Authenticated Origin Pulls) und Caddy so konfigurieren, dass es das Cloudflare-Client-Zertifikat verlangt. Damit erreicht niemand den Origin an Cloudflare vorbei.
- Für `gsc2mcp-direct` stellt **Caddy selbst ein Let's-Encrypt-Zertifikat** aus (der Host ist DNS-only, Cloudflare terminiert dort nichts).

## 3. Cache-Regel für den MCP-Pfad (zwingend)

MCP nutzt langlebige Server-Sent-Events. Wird der Pfad gecacht oder umkodiert, bricht der Transport.

**Caches Rules → Create rule:**
- Wenn `Hostname eq "gsc2mcp.drossmedia.de" and URI Path starts with "/mcp"`
- Dann **Bypass cache**.

Der Server sendet zusätzlich `Cache-Control: no-cache, no-transform`. Das `no-transform` verhindert Umkodierung am Rand; der SSE-Keepalive (alle 30 s, serverseitig) hält die Verbindung gegen das nicht abschaltbare 900-s-Idle-Timeout offen ([docs/01](../docs/01-architektur.md)).

## 4. Ratenbegrenzung auf die OAuth-Endpunkte

Dynamic Client Registration ist unauthentifiziert und legt Datensätze an — ein klassisches Missbrauchsziel. Am Rand abgefangen, erreicht eine Missbrauchswelle den Server gar nicht erst.

**Security → WAF → Rate limiting rules:**
- Wenn `Hostname eq "gsc2mcp.drossmedia.de" and (URI Path eq "/register" or URI Path eq "/token")`
- Zählung nach IP, z. B. **> 20 Anfragen / 1 min** → **Block** für 1 min (Werte nach echtem Bedarf justieren).

## 5. Firewall am Origin

`ufw` auf dem netcup-Server:
- Port **443** nur aus den [Cloudflare-IP-Bereichen](https://www.cloudflare.com/ips/) zulassen (für den proxied Host).
- Port **443** zusätzlich offen für den Direktweg `gsc2mcp-direct` — dieser Traffic kommt **nicht** aus den Cloudflare-Bereichen. Praktisch heißt das: 443 generell offen, aber Authenticated Origin Pulls sorgt dafür, dass der proxied Hostname nur Cloudflare-Zertifikate akzeptiert; der Direkthost läuft über sein eigenes Let's-Encrypt-Zertifikat.
- **22** (SSH) nur aus bekannten Netzen oder über Bastion. Alles Übrige zu.

## 6. Verifikation

- `dig +short gsc2mcp.drossmedia.de` → Cloudflare-Anycast-IP (proxied).
- `dig +short gsc2mcp-direct.drossmedia.de` → `<ORIGIN_IP>` (direkt).
- MCP-Sitzung in Claude gegen `https://gsc2mcp.drossmedia.de/mcp` verbinden und **20 Minuten Leerlauf** halten — bestätigt, dass Keepalive und Cache-Bypass greifen ([docs/09](../docs/09-roadmap.md), Abnahme Phase 1).
- Externe Uptime-Prüfung auf **beide** Hostnamen, damit sich ein Cloudflare-Problem von einem Server-Problem unterscheiden lässt.

## Reihenfolge im Kontext von Phase 0

1. netcup RS bestellen → `<ORIGIN_IP>` steht fest.
2. Server härten, Caddy + Origin-Zertifikat einrichten.
3. Records aus Abschnitt 1 anlegen, Einstellungen 2–5 setzen.
4. Erst danach die Google-OAuth-Verifizierung einreichen — die Datenschutzerklärung muss unter `https://gsc2mcp.drossmedia.de` erreichbar sein ([docs/02](../docs/02-auth.md)).
