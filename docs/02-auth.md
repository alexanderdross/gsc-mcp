# 02 — Authentifizierung

Es gibt zwei OAuth-Ebenen, die konsequent getrennt bleiben. Ihre Vermischung wäre der schwerwiegendste denkbare Sicherheitsfehler dieses Systems.

```
   Claude                unser Server                    Google
     │                        │                            │
     │─── Ebene 1: OAuth 2.1 ─▶                            │
     │    (wir sind AS)       │─── Ebene 2: OAuth 2.0 ─────▶
     │                        │    (wir sind Client)       │
     │                        │                            │
     │◀── unser Access-Token ─│◀── Google-Refresh-Token ───│
          (nur für uns gültig)     (verschlüsselt in PostgreSQL,
                                    verlässt den Server nie)
```

## Ebene 1 — Claude ↔ unser Server

Unser Server ist zugleich Authorization Server. Claude kennt keine API-Keys; ein Remote-Connector wird durch Angabe der Server-URL hinzugefügt, alles Weitere handeln die Protokolle aus.

**Bereitzustellende Endpunkte**

| Endpunkt | Zweck |
|---|---|
| `/.well-known/oauth-protected-resource` | Protected Resource Metadata (RFC 9728) — verweist auf den AS |
| `/.well-known/oauth-authorization-server` | AS-Metadata — Endpunkte, unterstützte Verfahren |
| `/register` | Dynamic Client Registration (RFC 7591) — Claude registriert sich selbst |
| `/authorize` | Autorisierung mit PKCE; leitet zur Google-Zustimmung weiter |
| `/token` | Token-Ausgabe und -Erneuerung |
| `/mcp` | der geschützte MCP-Endpunkt (Streamable HTTP) |

**Anforderungen:** OAuth 2.1 mit PKCE (S256), Dynamic Client Registration, Resource Indicators (RFC 8707) — damit ein für uns ausgestelltes Token nicht bei einem anderen Server verwendet werden kann. Redirect-Ziel im Claude-Client ist `https://claude.ai/api/mcp/auth_callback`; es wird nicht fest verdrahtet, sondern kommt aus der Client-Registrierung und wird gegen eine Allowlist geprüft.

**Umsetzung:** `node-oidc-provider` deckt Registrierung, Autorisierungscodes, Token-Ausgabe und -Rotation ab und legt den Zustand in PostgreSQL. Der eigene Code beschränkt sich auf den Zustimmungsschritt und die Verknüpfung mit der Google-Identität.

**Token-Design:** Kurzlebige Access-Tokens (eine Stunde) mit Refresh-Token-Rotation. Das Token trägt `user_id` und Scope, aber niemals Google-Credentials. Widerruf ist serverseitig sofort wirksam, weil jeder Request den Grant in der Datenbank prüft.

> **Umsetzung (Stand):** Die netzunabhängigen Bausteine stehen in `apps/app/src/oauth/` und sind vollständig getestet: Metadaten (RFC 8414/9728, `metadata.ts`), PKCE-S256 (`pkce.ts`), Dynamic Client Registration mit Redirect-Allowlist (`dcr.ts`), Client-/Token-Speicher als Schnittstelle plus In-Memory-Variante (`store.ts`) und der Bearer-Authentifikator, der die `Authorization`-Kopfzeile auf eine Router-`Session` abbildet, Ablauf und Zielressource (RFC 8707) prüft und den MCP-Transport bedient (`authenticator.ts`). Der vollständige Autorisierungs-Fluss ist als reine Logik umgesetzt (`provider.ts`): `/authorize` mit Client-/Redirect-/PKCE-Prüfung → Weiterleitung zur Google-Zustimmung → Rückkanal → einmalig einlösbarer Authorization-Code → `/token` (Authorization-Code- und Refresh-Token-Grant mit Rotation). Der Google-Umweg (`GoogleAuth`), die Nutzerverknüpfung (`UserDirectory`) und die Speicher sind injiziert. Konkret umgesetzt und getestet sind inzwischen: der `GoogleAuth`-Adapter (`GoogleOAuth`, injizierbares `fetch`, Consent-URL und Code-Tausch mit `id_token`-Auswertung), die AES-256-GCM-Verschlüsselung des Refresh-Tokens (`crypto.ts`), die persistenten Speicher gegen `packages/db` (`db-stores.ts`: Client-, Token-, Code- und Pending-Store; Code-Einlösung als `DELETE … RETURNING`) sowie das `DbUserDirectory` (Upsert über `google_sub`, verschlüsselte Ablage in `core.google_credentials`) — der volle Fluss `authorize → callback → token` ist end-to-end gegen echtes PostgreSQL geprüft. Damit ist ein schlanker, eigener AS möglich; ob stattdessen `node-oidc-provider` davorgesetzt wird, bleibt eine Entscheidung beim Verdrahten — die Schnittstellen bleiben gleich. Offen bleibt nur das Netzgebundene: die echten Google-Endpunkte und der Schlüssel aus einem Secret sowie das Ausliefern über HTTP.

## Ebene 2 — unser Server ↔ Google

Innerhalb des `/authorize`-Flows wird der Nutzer zu Google weitergeleitet.

**Scopes**

| Scope | Zweck | Wann |
|---|---|---|
| `openid`, `email` | Identität, Kontozuordnung | immer |
| `https://www.googleapis.com/auth/webmasters.readonly` | alle Lesezugriffe auf Search Console | immer |
| `https://www.googleapis.com/auth/webmasters` | Sitemaps einreichen/löschen | **nur opt-in**, separater Zustimmungsschritt |

**BigQuery taucht hier bewusst nicht auf.** Der Zugriff auf den Bulk Data Export des Kunden läuft nicht über einen OAuth-Scope, sondern über eine Dataset-Freigabe an unser Dienstkonto ([12-wettbewerb-usp.md](12-wettbewerb-usp.md)). Das erspart es, `bigquery.readonly` in der ohnehin kritischen Verifizierung mitrechtfertigen zu müssen — und der Kunde kann die Freigabe jederzeit einseitig entziehen.

Der Schreib-Scope ist bewusst getrennt. Die überwiegende Mehrheit der Nutzer braucht ihn nie, und ein reiner Lesezugriff ist sowohl bei der Google-Verifizierung als auch im Verkaufsgespräch mit Sicherheitsabteilungen deutlich leichter zu vertreten.

**Parameter:** `access_type=offline` und `prompt=consent` beim Erstzugriff, damit ein Refresh-Token ausgegeben wird — ohne diese Kombination liefert Google bei wiederholter Autorisierung keines, und der Sync bricht still nach einer Stunde ab.

**Token-Handling**

- Der **Refresh-Token** wird AES-GCM-verschlüsselt in `google_credentials.refresh_token_enc` gespeichert. Der Schlüssel wird als Datei eingehängt (systemd-Credential), nicht im Code und nicht in der Datenbank. Zufälliger IV je Datensatz; das `bytea`-Feld enthält IV, Chiffrat und Auth-Tag, die Schlüsselversion steht daneben.
- Der **Access-Token** wird bei Bedarf erneuert und in einem prozesslokalen LRU-Cache gehalten, mit einer Gültigkeit etwas unterhalb der Token-Laufzeit. Das vermeidet einen Google-Roundtrip pro Tool-Call. Der `tokenProvider` ist die eine Stelle, an der der Client (`packages/gsc-client`) diesen Token bezieht — er ist injizierbar, weshalb der Client ohne echte Google-Anbindung testbar bleibt.
- **Beides verlässt den Server niemals.** Claude bekommt ausschließlich unser eigenes Token. Ein kompromittierter Client kann damit nur unsere API ansprechen — nicht das Google-Konto des Nutzers.
- Bei `invalid_grant` (Nutzer hat den Zugriff bei Google widerrufen) wird die Property auf `sync_enabled = false` gesetzt, der Nutzer benachrichtigt, und betroffene Tools liefern eine klare Handlungsaufforderung zur Neuverbindung statt eines technischen Fehlers.

## Google-OAuth-Verifizierung — der kritische Pfad

`webmasters.readonly` ist ein **sensitiver Scope**. Ohne Verifizierung greift Googles Nutzerobergrenze (Größenordnung 100 Nutzer) und ein Warnbildschirm im Zustimmungsdialog, der Konversionsraten zerstört.

**Was Google verlangt**

- Verifizierte Domain-Inhaberschaft für alle Redirect-URIs und Startseiten
- Öffentliche Datenschutzerklärung auf derselben Domain, die den Scope-Einsatz ausdrücklich benennt
- Demo-Video, das den kompletten Zustimmungsablauf und die Datennutzung im Produkt zeigt
- Brand Verification (App-Name, Logo, Startseite)
- Begründung, warum der Scope für die Funktion erforderlich ist

**Bearbeitungsdauer:** typischerweise mehrere Wochen, mit Rückfragezyklen. Deshalb steht die Einreichung in Phase 0 der Roadmap — vor der Implementierung, nicht danach. Wird sie wie üblich ans Ende gelegt, blockiert sie den kommerziellen Start um genau diese Wochen.

Bis zur Freigabe ist der Betrieb im Testmodus mit bis zu 100 explizit eingetragenen Testnutzern möglich. Für Eigenbedarf und eine geschlossene Beta reicht das vollständig aus.

**Quotenerhöhung** wird im selben Zug beantragt: Die Search-Console-Kontingente gelten pro Cloud-Projekt und werden über alle Kunden geteilt. Das Formular verlangt eine belastbare Bedarfsbegründung, weshalb die Rechnung aus [04-sync-pipeline.md](04-sync-pipeline.md) direkt dorthin einfließt.

## Verbindungsablauf aus Nutzersicht

```
1. Nutzer fügt in Claude einen Connector hinzu: https://gsc2mcp.drossmedia.de/mcp
2. Claude entdeckt Protected Resource Metadata → registriert sich per DCR
3. Claude öffnet /authorize; unser Server erkennt: kein Google-Konto verknüpft
4. Weiterleitung zur Google-Zustimmung (openid, email, webmasters.readonly)
5. Google-Callback → Refresh-Token verschlüsselt speichern, Nutzer anlegen/finden
6. Zustimmungsseite: "Claude Zugriff auf Ihre Search-Console-Daten gewähren?"
7. Autorisierungscode → Claude tauscht ihn gegen unser Access-Token
8. Erster Tool-Call: get_started → listet Properties, schlägt Sync-Start vor
```

Schritt 8 ist der eigentliche Onboarding-Moment. `get_started` zeigt die verfügbaren Properties, die Berechtigungsstufe je Property und bietet an, den Backfill zu starten — mit ehrlicher Angabe der Dauer.

## Mandantentrennung

`user_id` leitet sich aus Googles `sub` ab, nicht aus der E-Mail-Adresse (E-Mails ändern sich, `sub` nicht). Jede Warehouse-Abfrage filtert zwingend auf `property_id`, und jede `property_id` wird vor Gebrauch gegen `properties.user_id` geprüft — nicht im Handler, sondern zentral im Tool-Router, damit ein vergessener Filter in einem einzelnen Handler keinen Datenabfluss zwischen Mandanten verursachen kann.

Team-Zugänge (mehrere Nutzer auf einer Property, Agency-Plan) sind ab Phase 6 vorgesehen. Das Schema hält den Weg über eine spätere `memberships`-Tabelle offen; bis dahin gilt strikt ein Eigentümer je Property.
