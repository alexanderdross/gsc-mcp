# 11 — Go-to-Market

## Der entscheidende Vertriebskanal

Advanced GSC ist im **Claude Connector Directory** gelistet. Das ist kein Nebenschauplatz: Ein Nutzer, der in Claude nach einer Search-Console-Anbindung sucht, findet dort genau einen Anbieter — und installiert ihn. Das Directory ist zugleich Vertriebskanal und Vertrauenssignal, und die Listung ist geprüft, also nicht beliebig vermehrbar.

Zweiter Anbieter in einer etablierten Kategorie zu sein, ist dabei kein Nachteil, sondern erleichtert die Positionierung: Die Kategorie ist bereits erklärt, es muss nur noch der Unterschied vermittelt werden.

## Anforderungen der Directory-Einreichung

Aus der Anthropic-Dokumentation und Erfahrungsberichten eingereichter Connectoren (Stand 2026):

| Anforderung | Umsetzung bei uns |
|---|---|
| **Alle Tools mit `title` und `readOnlyHint`/`destructiveHint` annotiert** | in `defineTool` verpflichtendes Feld; 25 von 26 Tools sind `readOnly`, `submit_sitemap` ist das einzige schreibende und nicht destruktiv |
| **Öffentliche Datenschutzerklärung** | Phase 4; häufigster Ablehnungsgrund überhaupt, wenn sie fehlt oder unvollständig ist |
| **HTTPS für alle Verbindungen** | Cloudflare, HSTS |
| **OAuth 2.0 für authentifizierte Dienste** | OAuth 2.1 mit DCR, siehe [02-auth.md](02-auth.md) |
| **Nachweis der Rechte an API und Domain** | wir greifen ausschließlich auf Google-APIs im Namen des Nutzers zu, mit dessen Zustimmung — keine fremde API wird ohne Einwilligung umhüllt |
| **Öffentliche Dokumentation, in zehn Minuten ohne Vorkenntnisse testbar** | Doku-Seite im `web`-Worker mit Einrichtung, Auth und mindestens drei Beispielprompts, die verschiedene Tools ansprechen |
| **Testzugang mit realistischen Beispieldaten** | dediziertes Konto auf `staging` mit einer Property samt vollständigem Backfill |
| **Logo und Favicon** | Phase 4 |
| **Bei MCP Apps: 3–5 Screenshots, mindestens 1.000 px breit** | vom `performance_explorer` |

Reine Machine-to-Machine-Authentifizierung über `client_credentials` wird als nutzerseitiger Connector-Flow nicht akzeptiert — jeder Nutzer durchläuft eine eigene Zustimmung. Das entspricht unserem Entwurf ohnehin.

**Zeitpunkt:** Einreichung am Ende von Phase 5, nachdem die Google-Verifizierung erteilt ist. Ein Connector, der im Zustimmungsdialog eine Google-Warnung zeigt, wird die Directory-Prüfung nicht bestehen.

## Positionierung

**Kernaussage:** *Alle Search-Console-Daten in Claude — mit einer Historie, die nicht nach 16 Monaten endet.*

Gegen den Wettbewerber wird nicht über Funktionsanzahl argumentiert, sondern über die drei Dinge, die er strukturell nicht kann:

1. Jahresvergleiche über 16 Monate hinaus
2. Longtail-Auswertungen ohne Sampling
3. proaktive Anomalie-Erkennung statt reiner Frage-Antwort

Dazu kommt für den deutschsprachigen Markt: EU-Hosting, AVV, deutschsprachiger Support.

**Ehrlich benannt wird auch, was fehlt:** keine SERP-Daten, keine Backlinks, kein Keyword-Volumen, vorerst kein GA4. Wer das braucht, ist beim Wettbewerber besser aufgehoben — und das offen zu sagen, kostet weniger als eine Erstattung nach zwei Wochen.

## Zielgruppen und Kanäle

| Segment | Ansprache |
|---|---|
| In-House-SEOs, Solo-Betreiber | Directory, SEO-Communities, Fachbeiträge zu GSC-API-Grenzen |
| Agenturen (DACH) | Direktansprache, AVV und EU-Hosting als Türöffner, Agency-Plan |
| Claude-Power-User | Directory, Beispieldialoge, MCP-Verzeichnisse Dritter |

Die wirksamste Inhaltsform dürfte sein, das Produkt an eigenen Daten vorzuführen: eine tatsächliche Analyse eines tatsächlichen Traffic-Einbruchs, mit den Zahlen und der Zerlegung in Nachfrage-, Ranking- und Snippet-Anteil. Das lässt sich nicht behaupten, nur zeigen.

## Startreihenfolge

1. **Geschlossene Beta** — bis zu 100 Testnutzer, die Google im Testmodus erlaubt. Reicht aus, um Onboarding, Backfill-Dauer und Plan-Grenzen an echten Nutzern zu prüfen, bevor Geld fließt.
2. **Öffentlicher Start** nach erteilter Google-Verifizierung, mit Stripe im Livemodus.
3. **Directory-Einreichung** unmittelbar danach.
4. **Agentur-Ansprache**, sobald Team-Zugänge stehen (Phase 6).

Die Reihenfolge ist durch Abhängigkeiten bestimmt, nicht durch Vorlieben: Ohne Verifizierung kein öffentlicher Start, ohne öffentlichen Start keine Directory-Listung, ohne Team-Zugänge kein ernsthaftes Agenturgeschäft.

## Preisbeobachtung

Der Wettbewerber betreibt aktuell eine Gründungsmitglieder-Aktion in Runden zu je 100 Plätzen. Das deutet auf Preisexperimente in einem frühen Markt hin — die Preisstufen aus [07-billing.md](07-billing.md) sollten vor dem öffentlichen Start noch einmal gegen den dann gültigen Marktstand geprüft werden, statt sie jetzt festzuschreiben.
