# 08 — Sicherheit und Datenschutz

Datenschutz ist hier kein nachgelagerter Pflichtteil, sondern Teil des Produktversprechens: EU-Hosting und ein sauberer AVV sind gegenüber dem US-Wettbewerber ein Verkaufsargument — aber nur, wenn sie belastbar sind. Genau deshalb ist die Cloudflare-Ebene der heikelste Punkt dieses Kapitels und wird unten offen behandelt.

## Welche Daten verarbeitet werden

| Kategorie | Inhalt | Personenbezug |
|---|---|---|
| Kontodaten | E-Mail, Google-`sub`, Sprache | ja |
| Zahlungsdaten | bei Stripe; wir speichern nur die Customer-ID | mittelbar |
| Google-Credentials | Refresh-Token (verschlüsselt) | ja, hochsensibel |
| Search-Console-Daten | Suchanfragen, URLs, Klicks, Impressionen, Positionen | in der Regel nein¹ |
| Betriebsdaten | Audit-Log, Nutzungsereignisse, Sync-Zustand | ja |
| Verbindungsdaten am Proxy | IP-Adressen, Anfragemetadaten | ja |

¹ Google anonymisiert seltene Suchanfragen bereits vor der Auslieferung und liefert keine Nutzerkennungen. Ein Personenbezug ist damit im Regelfall ausgeschlossen; im Einzelfall können Suchanfragen aber Namen enthalten. Die Datenschutzerklärung benennt das ausdrücklich, statt pauschal Anonymität zu behaupten.

## Datenresidenz

| Ort | Was liegt dort | Bewertung |
|---|---|---|
| netcup, Nürnberg | **alle Nutzdaten**: PostgreSQL, Anwendung, Logs | deutscher Anbieter, deutsche Rechenzentren |
| Offsite-Objektspeicher (EU) | Backups, Parquet-Kaltarchiv | EU-Anbieter, verschlüsselt |
| Cloudflare | **keine Speicherung von Nutzdaten**, aber TLS-Terminierung und damit Verarbeitung im Transit | siehe unten |
| Stripe | Zahlungsdaten | eigener Auftragsverarbeiter |

**Daten im Ruhezustand verlassen Deutschland nicht.** Das ist der belastbare Kern des Versprechens.

## Die Cloudflare-Ebene — ehrlich betrachtet

Cloudflare terminiert TLS und sieht damit Anfrageinhalte und IP-Adressen im Klartext. Das ist eine Auftragsverarbeitung im Sinne von Art. 28 DSGVO und erfordert einen AVV mit Cloudflare; das Unternehmen stellt einen bereit. Cloudflare Inc. ist ein US-Unternehmen, und ohne die kostenpflichtige Data-Localization-Ergänzung kann die Verarbeitung im Transit auch außerhalb der EU stattfinden.

Für die überwiegende Mehrheit der Kunden ist das unproblematisch und Marktstandard. Für einen Teil des Zielsegments — Agenturen mit Behörden- oder Mittelstandskunden, deren Beschaffung keinen US-Auftragsverarbeiter zulässt — ist es ein K.-o.-Kriterium, und genau dieses Segment ist der Grund, warum EU-Hosting überhaupt beworben wird.

**Deshalb der unproxied Zweitname.** Ein zweiter Hostname, dessen DNS-Eintrag nicht über Cloudflare läuft, zeigt direkt auf den Server in Nürnberg. Kunden mit strengen Anforderungen verbinden sich darüber; für sie ist Cloudflare an keiner Stelle beteiligt. Er kostet ein zusätzliches Let's-Encrypt-Zertifikat und einen DNS-Eintrag und löst nebenbei ein zweites Problem — einen Cloudflare-Ausfall ([01-architektur.md](01-architektur.md)).

Diese Wahlmöglichkeit gehört in Datenschutzerklärung und AVV ausdrücklich beschrieben. Sie unerwähnt zu lassen und trotzdem mit „EU-Hosting" zu werben, wäre irreführend.

## Schutz der Google-Credentials

Der Refresh-Token ist der kritischste Datensatz im System — er gewährt dauerhaften Lesezugriff auf die Search Console des Kunden.

- **Verschlüsselung** mit AES-256-GCM, zufälliger IV je Datensatz. Das `bytea`-Feld enthält IV, Chiffrat und Auth-Tag; `key_version` erlaubt Rotation ohne Ausfall.
- **Schlüssel** über systemd-Credentials bzw. eine Datei mit `0600` außerhalb des Repositories, im Container als Secret eingehängt. Niemals in PostgreSQL, niemals im Image, niemals im Git.
- **Niemals ausgeliefert.** Claude erhält ausschließlich unser eigenes Token. Ein kompromittierter Client kann damit nur unsere API ansprechen — nicht das Google-Konto des Nutzers.
- **Minimale Scopes.** Lesezugriff als Standard, Schreibzugriff nur nach separatem opt-in.
- **Widerruf** löscht den Datensatz sofort und ruft zusätzlich Googles Revoke-Endpunkt auf.

Ein Restrisiko bleibt und soll benannt sein: Auf einem selbst betriebenen Server liegen Schlüssel und Chiffrat auf derselben Maschine. Wer Root erlangt, erlangt beides. Das ist bei einer verwalteten Plattform mit getrenntem Secret-Store anders. Gegenmaßnahmen sind Härtung, minimale Angriffsfläche und Festplattenverschlüsselung — kein vollständiger Ersatz, aber der Unterschied zwischen „schwierig" und „trivial".

## Serverhärtung

| Bereich | Maßnahme |
|---|---|
| Zugang | SSH nur mit Schlüssel, Passwort-Login und Root-Login deaktiviert, `fail2ban` |
| Firewall | `ufw`: 443 **nur aus Cloudflare-IP-Bereichen**, SSH nur aus bekannten Netzen oder über einen Bastion-Zugang; sonst nichts |
| Datenbank | PostgreSQL bindet ausschließlich auf localhost, kein externer Port |
| Aktualisierungen | `unattended-upgrades` für Sicherheitspakete, monatliches Wartungsfenster für den Rest |
| Container | keine Root-Prozesse, Read-only-Dateisysteme wo möglich, Images regelmäßig neu gebaut |
| Festplatte | Verschlüsselung des Datenverzeichnisses |
| Origin-Schutz | Full (strict) plus Authenticated Origin Pulls, damit niemand an Cloudflare vorbei zugreift |

## Mandantentrennung

Die Prüfung, ob eine `property_id` dem anfragenden Nutzer gehört, erfolgt **zentral im Tool-Router**, nicht in den einzelnen Handlern. Ein vergessener Filter in einem von 26 Handlern darf keinen Datenabfluss zwischen Kunden verursachen können.

Abgesichert durch einen Test, der über die Tool-Registry iteriert, für jeden registrierten Handler einen fremden Zugriff versucht und einen Fehler erwartet. Er läuft in CI und deckt ein neu hinzugefügtes Tool automatisch mit ab, auch wenn niemand daran denkt. *(Umsetzung: die zentrale Prüfung sitzt in `apps/app/src/router.ts` mit injizierbarem `ownershipCheck`; der registry-weite Test in `apps/app/test/router.test.ts`.)*

Zusätzlich ist zu prüfen, ob PostgreSQL Row-Level-Security als zweite Verteidigungslinie sinnvoll ist. Für den Anfang genügt die zentrale Prüfung; RLS ist ein guter Kandidat für die Zeit nach dem Livegang, wenn das Schema stabil ist.

## Löschkonzept

**Nutzerseitig** über Dashboard und `/account/delete`:

1. Google-Zugriff widerrufen (Revoke-Aufruf), Credentials löschen
2. Alle Faktendaten aller Properties löschen — mit `ON DELETE CASCADE` und Partitionierung ist das ein einziger Vorgang, kein Shard-Durchlauf
3. Offsite-Objekte der Properties löschen
4. Stripe-Abo kündigen, Customer behalten (handelsrechtliche Aufbewahrung der Rechnungen)
5. Konto anonymisieren: `deleted_at` setzen, E-Mail durch einen Hash ersetzen
6. Audit-Log 30 Tage aufbewahren (Missbrauchsaufklärung), dann löschen

Vollzug innerhalb von 30 Tagen, Bestätigung per E-Mail.

Ein Punkt wird oft übersehen: **Backups enthalten die gelöschten Daten weiter.** Bei einer Aufbewahrung von 30 Tagen sind gelöschte Daten also bis zu 30 Tage nach Vollzug noch in Sicherungen vorhanden. Das ist zulässig, muss aber in der Datenschutzerklärung stehen — mit der Zusage, dass Sicherungen nicht für andere Zwecke ausgewertet und bei Wiederherstellung erneut bereinigt werden.

**Aufbewahrungsfristen**

| Daten | Frist |
|---|---|
| Warehouse nach Kündigung | 90 Tage, dann Löschung |
| Backups | 30 Tage rollierend |
| Audit-Log | 12 Monate |
| Nutzungsereignisse | 24 Monate (aggregiert unbefristet) |
| Rechnungen | 10 Jahre (§ 147 AO) |
| Stundendaten | 14 Tage rollierend |

## Google API Services User Data Policy

Der sensitive Scope verpflichtet zur Limited-Use-Anforderung:

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
| SQL | ausschließlich parametrisiert; Regex- und `contains`-Filter aus Nutzereingaben nach Länge und Komplexität begrenzt (ReDoS) |
| Missbrauch am Rand | Cloudflare-Ratenbegrenzung auf `/register` und `/token` — Dynamic Client Registration ist unauthentifiziert und legt Datensätze an |
| Ausgabe an Claude | keine rohen HTML-Inhalte; MCP-Apps-Oberflächen laufen in der abgeschotteten iframe des Clients |
| Secrets | systemd-Credentials bzw. eingehängte Secret-Dateien; im Repository nur `.env.example` |
| Abhängigkeiten | Dependabot, `npm audit` in CI |
| Logs | keine Query-Texte, keine URLs, keine Tokens — Parameter nur als SHA-256-Hash |

Die Log-Regel ist bewusst streng. Suchanfragen sind Geschäftsgeheimnisse des Kunden; sie in Betriebsprotokollen zu führen wäre auch dann falsch, wenn kein Personenbezug bestünde.

## Rechtliche Artefakte

Vor dem kommerziellen Start bereitzustellen — mehrere davon sind zugleich harte Voraussetzung für die Google-Verifizierung und die Directory-Listung:

| Dokument | Zweck |
|---|---|
| Datenschutzerklärung | DSGVO Art. 13/14 + Google-Verifizierung + Directory (dort Ablehnungsgrund Nr. 1) |
| AGB | Vertragsgrundlage, Haftung, Verfügbarkeit |
| AVV (Art. 28 DSGVO) | zwingend für Agenturkunden; deren Kunden sind die Verantwortlichen |
| Verzeichnis von Verarbeitungstätigkeiten | Art. 30 DSGVO, intern |
| Unterauftragsverarbeiter-Liste | netcup, **Cloudflare**, Google, Stripe, Objektspeicher, E-Mail-Versand |
| Impressum | § 5 DDG |
| TOM-Beschreibung | Anlage zum AVV |

Cloudflare gehört ausdrücklich auf die Unterauftragsverarbeiter-Liste, zusammen mit dem Hinweis auf den direkten Zugangsweg für Kunden, die das nicht wollen.

Eine juristische Prüfung ist vor dem Livegang einzuholen. Diese Aufstellung ersetzt sie nicht.

## Betriebsüberwachung

Alarme auf: Sync-Fehlerquote, Datenbankgröße, Google-Quotenausschöpfung, Rate der `401`/`invalid_grant` (Hinweis auf ein Auth-Problem), fehlgeschlagene Stripe-Webhooks, Antwortzeit des MCP-Endpunkts, freier Plattenplatz, Backup-Erfolg.

**Die Verfügbarkeitsprüfung läuft extern und auf beiden Hostnamen** — proxied und direkt. Nur so lässt sich ein Cloudflare-Problem von einem Server-Problem unterscheiden, und nur so wird ein Ausfall überhaupt bemerkt: Eine Überwachung, die mit dem Überwachten ausfällt, meldet nie etwas.

**Wiederherstellung:** pgBackRest mit Point-in-Time-Recovery. Das Warehouse ist im Notfall aus der Google-API rekonstruierbar — aber nur für die letzten 16 Monate. **Alles Ältere existiert ausschließlich bei uns.** Die Backups und die monatlichen Parquet-Exporte sind deshalb keine Bequemlichkeit, sondern die einzige Sicherung des eigentlichen Alleinstellungsmerkmals. Eine Wiederherstellungsübung gehört vor den Livegang, nicht in den Ernstfall.
