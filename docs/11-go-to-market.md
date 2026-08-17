# 11 — Go-to-Market

Die Wettbewerbsanalyse und der daraus abgeleitete USP stehen in [12-wettbewerb-usp.md](12-wettbewerb-usp.md). Dieses Kapitel behandelt, wie das Produkt zu seinen Nutzern kommt.

## Marke und Domain

**`gsc2mcp.com`**, registriert über Cloudflare Registrar zum Einkaufspreis.

| Hostname | Zweck |
|---|---|
| `www.gsc2mcp.com` | Landingpage, Dashboard, Dokumentation, Rechtliches |
| `api.gsc2mcp.com` | MCP-Endpunkt und OAuth — über Cloudflare proxied |
| `eu.gsc2mcp.com` | dieselben Endpunkte, DNS-only, direkt nach Nürnberg |

Der dritte Hostname ist kein technisches Detail, sondern ein Verkaufsargument: Er ist der Zugangsweg für Kunden, deren Beschaffung keinen US-Auftragsverarbeiter zulässt, und zugleich der Notweg bei einem Cloudflare-Ausfall ([08-security-dsgvo.md](08-security-dsgvo.md)). Der Name sagt, wozu er da ist.

**Zur Namenswahl:** Der Name benennt die technische Verbindung, nicht den Nutzen, und bindet die Marke an das MCP-Protokoll. Das ist eine bewusste Entscheidung für die technisch versierte Zielgruppe. Die Konsequenz für das Marketing: **Der Nutzen muss in der Überschrift stehen, weil er nicht im Namen steht.** Nicht „GSC zu MCP", sondern „Vollständige Search-Console-Daten in deinem KI-Assistenten — auch die, die Google längst gelöscht hat."

## Der entscheidende Vertriebskanal

Advanced GSC ist im **Claude Connector Directory** gelistet. Ein Nutzer, der in Claude nach einer Search-Console-Anbindung sucht, findet dort einen Anbieter — und installiert ihn. Das Directory ist zugleich Vertriebskanal und Vertrauenssignal, und die Listung ist geprüft, also nicht beliebig vermehrbar.

Zweiter Anbieter in einer etablierten Kategorie zu sein, ist dabei kein Nachteil: Die Kategorie ist erklärt, es muss nur noch der Unterschied vermittelt werden — und der ist mit „arbeitet auf Googles vollständigem Datenexport" in einem Satz sagbar.

### Anforderungen der Einreichung

Aus der Anthropic-Dokumentation und Erfahrungsberichten eingereichter Connectoren (Stand 2026):

| Anforderung | Umsetzung |
|---|---|
| **Alle Tools mit `title` und `readOnlyHint`/`destructiveHint`** | in `defineTool` verpflichtend; 25 von 26 Tools sind `readOnly`, `submit_sitemap` ist das einzige schreibende und nicht destruktiv |
| **Öffentliche Datenschutzerklärung** | Phase 4; häufigster Ablehnungsgrund, wenn sie fehlt oder unvollständig ist |
| **HTTPS durchgängig** | Cloudflare plus HSTS |
| **OAuth 2.0 für authentifizierte Dienste** | OAuth 2.1 mit DCR ([02-auth.md](02-auth.md)) |
| **Nachweis der Rechte an API und Domain** | Zugriff ausschließlich auf Google-APIs im Namen des Nutzers, mit dessen Zustimmung — keine fremde API wird ohne Einwilligung umhüllt |
| **Dokumentation, in zehn Minuten ohne Vorkenntnisse testbar** | Doku-Seite auf `www` mit Einrichtung, Auth und mindestens drei Beispielprompts über verschiedene Tools |
| **Testzugang mit realistischen Beispieldaten** | dediziertes Konto auf `staging` mit vollständig befüllter Property |
| **Logo und Favicon** | Phase 4 |
| **Bei MCP Apps: 3–5 Screenshots, min. 1.000 px breit** | vom `performance_explorer` |

Reine Machine-to-Machine-Authentifizierung über `client_credentials` wird als nutzerseitiger Connector-Flow nicht akzeptiert — jeder Nutzer durchläuft eine eigene Zustimmung. Das entspricht unserem Entwurf ohnehin.

**Zeitpunkt:** Einreichung am Ende von Phase 5, nachdem die Google-Verifizierung erteilt ist. Ein Connector, der im Zustimmungsdialog eine Google-Warnung zeigt, besteht die Prüfung nicht.

## Sichtbarkeit bei Sprachmodellen

Advanced GSC betreibt eine Seite `ai-info.html` mit der Überschrift „AI INSTRUCTION: READ THIS PAGE — Facts for LLMs". Eine für Modelle geschriebene Faktenseite ist eine bewusste Maßnahme in einer Welt, in der Kaufentscheidungen zunehmend über Modelle vermittelt werden: Wer ein Modell fragt, welcher GSC-MCP-Server taugt, bekommt eine Antwort aus dem, was das Modell im Netz gefunden hat.

Das ist billig zu kopieren und sollte kopiert werden — mit einem Unterschied: Die Seite muss **prüfbare Aussagen** enthalten, keine Werbung. Datenquelle, Tool-Liste, Grenzen, Preise, Hosting-Standort. Modelle geben Konkretes weiter und ignorieren Superlative.

Dazu passt die eigene Dokumentation: strukturiert, mit klaren Überschriften, ohne Marketingfüllsel — sie ist die Quelle, aus der Modelle zitieren.

## Positionierung nach Segment

| Segment | Botschaft | Kanal |
|---|---|---|
| In-House-SEOs, Solo | „Alles, was Google über deine Site weiß — auch der Longtail, den kein anderes Werkzeug zeigt." | Directory, SEO-Communities, Fachbeiträge |
| **Agenturen (DACH)** | „Vollständige Daten, nachrechenbare Analysen, AVV, Server in Nürnberg." | Direktansprache, Agency-Plan |
| Technische SEOs | „Arbeitet auf Googles Bulk Data Export statt auf der limitierten API." | GitHub, MCP-Verzeichnisse, Fachbeiträge |

Nach der Marktanalyse ist das mittlere Segment das wirtschaftlich wichtigste ([00-konzept.md](00-konzept.md)): Gegen kostenlose Selbstbetriebs-Alternativen gewinnt man Einzelnutzer nur über Bequemlichkeit, und Bequemlichkeit trägt keine hohen Preise. Mandantentrennung, White-Label, AVV und ein Ansprechpartner dagegen schon.

## Der wirksamste Inhalt

Das Produkt an echten Daten vorführen. Eine tatsächliche Analyse eines tatsächlichen Traffic-Einbruchs, mit Zahlen und der Zerlegung in Nachfrage-, Ranking- und Snippet-Anteil. Das lässt sich nicht behaupten, nur zeigen.

Die zweitwirksamste Demonstration ist bereits gemessen und kostet nichts: **Bei `sc-domain:aip.aero` entfallen auf die 100 klickstärksten Suchanfragen 8,3 % der Klicks — die übrigen 91,7 % liegen darunter.** Diese eine Zahl erklärt in einem Satz, warum ein Werkzeug mit Zeilendeckel nicht reicht — und sie ist an jeder fremden Property reproduzierbar, was sie zu einem guten Aufhänger für einen Fachbeitrag macht.

## Startreihenfolge

1. **Geschlossene Beta** — bis zu 100 Testnutzer, die Google im Testmodus erlaubt. Reicht, um Onboarding, Bulk-Export-Einrichtung, Backfill-Dauer und Plan-Grenzen an echten Nutzern zu prüfen, bevor Geld fließt.
2. **Öffentlicher Start** nach erteilter Google-Verifizierung, mit Stripe im Livemodus.
3. **Directory-Einreichung** unmittelbar danach.
4. **Agentur-Ansprache**, sobald Team-Zugänge und AVV stehen.

Die Reihenfolge ist durch Abhängigkeiten bestimmt, nicht durch Vorlieben: ohne Verifizierung kein öffentlicher Start, ohne öffentlichen Start keine Directory-Listung, ohne Team-Zugänge kein ernsthaftes Agenturgeschäft.

## Preisbeobachtung

Der Wettbewerber betreibt eine Gründungsmitglieder-Aktion in Runden zu je 100 Plätzen — erklärtermaßen, um Feature-Wünsche beherrschbar zu halten. Zugleich drücken kostenlose Open-Source-Alternativen und eine gehostete Beta zum Nulltarif von unten.

Die Preisstufen aus [07-billing.md](07-billing.md) sind deshalb vor dem öffentlichen Start erneut gegen den dann geltenden Marktstand zu prüfen, statt sie jetzt festzuschreiben. Zu klären sind insbesondere die Preise von SEO Gets und SEOTesting, den beiden nächsten Wettbewerbern ([12-wettbewerb-usp.md](12-wettbewerb-usp.md)).
