# 08 — Sicherheit und Datenschutz

Die Datenschutz-Anforderungen sind hier kein nachgelagerter Pflichtteil, sondern Teil des Produktversprechens: EU-Hosting und ein sauberer AVV sind gegenüber dem US-Wettbewerber ein Verkaufsargument — aber nur, wenn sie belastbar sind.

## Welche Daten verarbeitet werden

| Kategorie | Inhalt | Personenbezug |
|---|---|---|
| Kontodaten | E-Mail, Google-`sub`, Sprache | ja |
| Zahlungsdaten | bei Stripe; wir speichern nur die Customer-ID | mittelbar |
| Google-Credentials | Refresh-Token (verschlüsselt) | ja, hochsensibel |
| Search-Console-Daten | Suchanfragen, URLs, Klicks, Impressionen, Positionen | in der Regel nein¹ |
| Betriebsdaten | Audit-Log, Nutzungsereignisse, Sync-Zustand | ja |

¹ Google anonymisiert seltene Suchanfragen bereits vor der Auslieferung und liefert keine Nutzerkennungen. Ein Personenbezug ist damit im Regelfall ausgeschlossen; im Einzelfall können Suchanfragen aber Namen enthalten. Die Datenschutzerklärung benennt diesen Umstand ausdrücklich, statt pauschal Anonymität zu behaupten.

## Datenresidenz

| Speicher | Maßnahme |
|---|---|
| D1 | Location Hint `weur` (Westeuropa) bei Anlage |
| Durable Objects | Jurisdictional Restriction `eu` — bindend, nicht nur ein Hinweis |
| R2 | Jurisdiktion EU |
| KV | global repliziert — **enthält deshalb keine personenbezogenen Nutzdaten**, nur kurzlebige Tokens und Entitlement-Flags |
| Stripe | eigener Auftragsverarbeiter, EU-Datenverarbeitung nach dessen Bedingungen |

Die KV-Einschränkung ist die einzige Stelle, an der die Architektur dem Datenschutz nachgibt: KV ist global repliziert und daher für personenbezogene Nutzdaten ungeeignet. Deshalb liegt dort ausschließlich, was ohnehin flüchtig ist.

## Schutz der Google-Credentials

Der Refresh-Token ist der kritischste Datensatz im System — er gewährt dauerhaften Lesezugriff auf die Search Console des Kunden.

- **Verschlüsselung** mit AES-256-GCM über WebCrypto, zufälliger IV je Datensatz. Das Feld enthält Schlüsselversion, IV und Chiffrat.
- **Schlüssel** in Workers Secrets, niemals in D1, niemals im Code, niemals im Repository. `key_version` in `google_credentials` ermöglicht Rotation ohne Ausfall.
- **Niemals ausgeliefert.** Claude erhält ausschließlich unser eigenes Token. Kein Tool und kein Endpunkt gibt Google-Credentials aus — auch nicht in Fehlermeldungen oder Logs.
- **Minimale Scopes.** Lesezugriff als Standard, Schreibzugriff nur nach separatem opt-in.
- **Widerruf** löscht den Datensatz sofort und ruft zusätzlich Googles Revoke-Endpunkt auf.

## Mandantentrennung

Die Prüfung, ob eine `property_id` dem anfragenden Nutzer gehört, erfolgt **zentral im Tool-Router**, nicht in den einzelnen Handlern. Ein vergessener Filter in einem von 26 Handlern darf keinen Datenabfluss zwischen Kunden verursachen können.

Abgesichert wird das durch einen Test, der für jeden registrierten Handler einen fremden Zugriff versucht und einen Fehler erwartet. Dieser Test läuft in CI und muss bei jedem neuen Tool automatisch mit abdecken — er iteriert über die Tool-Registry, nicht über eine gepflegte Liste.

## Löschkonzept

**Nutzerseitig** über Dashboard und `/account/delete`:

1. Google-Zugriff widerrufen (Revoke-Aufruf), Credentials löschen
2. Alle Faktendaten aller Properties löschen, inklusive Shards
3. R2-Objekte der Properties löschen
4. Stripe-Abo kündigen, Customer behalten (handelsrechtliche Aufbewahrung der Rechnungen)
5. Konto anonymisieren: `deleted_at` setzen, E-Mail durch einen Hash ersetzen
6. Audit-Log 30 Tage aufbewahren (Missbrauchsaufklärung), dann löschen

Vollzug innerhalb von 30 Tagen, Bestätigung per E-Mail.

**Aufbewahrungsfristen**

| Daten | Frist |
|---|---|
| Warehouse nach Kündigung | 90 Tage, dann Löschung |
| Audit-Log | 12 Monate |
| Nutzungsereignisse | 24 Monate (aggregiert unbefristet) |
| Rechnungen | 10 Jahre (§ 147 AO) |
| Stundendaten | 14 Tage rollierend |

## Google API Services User Data Policy

Der sensitive Scope verpflichtet zur Limited-Use-Anforderung. Konkret:

- Search-Console-Daten werden **ausschließlich** zur Erbringung der Funktion verwendet
- **Kein Training** von Modellen mit Kundendaten, keine Weitergabe, kein Verkauf, keine Werbenutzung
- Menschlicher Zugriff nur mit ausdrücklicher Zustimmung des Kunden oder zur Störungsbehebung, dokumentiert im Audit-Log
- Diese Zusagen stehen wörtlich in der Datenschutzerklärung — Google prüft das bei der Verifizierung

## Anwendungssicherheit

| Bereich | Maßnahme |
|---|---|
| Transport | ausschließlich HTTPS, HSTS |
| Tokens | kurzlebig, rotierend, serverseitig widerrufbar |
| Redirect-URIs | Allowlist, exakter Abgleich, keine Wildcards |
| Eingaben | Zod-Validierung jedes Tool-Parameters vor Ausführung |
| SQL | ausschließlich parametrisiert; Regex-Filter aus Nutzereingaben werden nach Länge und Komplexität begrenzt (ReDoS) |
| Ausgabe an Claude | keine rohen HTML-Inhalte; MCP-Apps-Oberflächen laufen in der abgeschotteten iframe des Clients |
| Secrets | Workers Secrets, im Repository nur `.dev.vars.example` |
| Abhängigkeiten | Dependabot, `npm audit` in CI |
| Logs | keine Query-Texte, keine URLs, keine Tokens — Parameter nur als SHA-256-Hash |

Die Log-Regel ist bewusst streng. Suchanfragen sind Kundengeschäftsgeheimnisse; sie in Betriebsprotokollen zu führen, wäre auch dann falsch, wenn kein Personenbezug bestünde.

## Rechtliche Artefakte

Vor dem kommerziellen Start bereitzustellen — mehrere davon sind zugleich harte Voraussetzung für die Google-Verifizierung und für die Directory-Listung:

| Dokument | Zweck |
|---|---|
| Datenschutzerklärung | DSGVO Art. 13/14 + Google-Verifizierung + Directory (dort Ablehnungsgrund Nr. 1) |
| AGB | Vertragsgrundlage, Haftung, Verfügbarkeit |
| AVV (Art. 28 DSGVO) | zwingend für Agenturkunden; deren Kunden sind die Verantwortlichen |
| Verzeichnis von Verarbeitungstätigkeiten | Art. 30 DSGVO, intern |
| Unterauftragsverarbeiter-Liste | Cloudflare, Stripe, Google, E-Mail-Versand |
| Impressum | § 5 DDG |
| TOM-Beschreibung | Anlage zum AVV |

Eine juristische Prüfung ist vor dem Livegang einzuholen. Diese Aufstellung ersetzt sie nicht.

## Betriebsüberwachung

Alarme auf: Sync-Fehlerquote, Datenbankgröße je Shard, Google-Quotenausschöpfung, Rate der `401`/`invalid_grant` (Hinweis auf ein Auth-Problem), fehlgeschlagene Stripe-Webhooks, Antwortzeit des MCP-Endpunkts.

Wiederherstellung: D1 Point-in-Time-Recovery für die Control Plane; das Warehouse ist im Notfall aus der Google-API rekonstruierbar, allerdings nur für die letzten 16 Monate. **Alles Ältere existiert ausschließlich bei uns** — die monatlichen Parquet-Exporte nach R2 sind deshalb keine Bequemlichkeit, sondern die einzige Sicherung des eigentlichen Alleinstellungsmerkmals.
