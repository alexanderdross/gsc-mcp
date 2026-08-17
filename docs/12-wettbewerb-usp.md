# 12 — Wettbewerb und USP

## Methodik und Grenzen

Erhoben im August 2026 über Websuche, GitHub, Anbieterdokumentation und eine Live-Abfrage der Tool-Registry von Advanced GSC über dessen eigenen `get_capabilities`-Endpunkt.

**Eine Einschränkung ist zu nennen:** `advancedgsc.com` ist aus der Arbeitsumgebung heraus durch die Netzwerkrichtlinie gesperrt; die Marketingseiten konnten nicht direkt gelesen werden. Die Angaben zu diesem Anbieter stammen aus der Live-Registry (belastbarer als jede Marketingseite), aus Suchergebnissen und aus Screenshots. Preise und Kontingente sind vor einer Preisentscheidung gegenzuprüfen.

## Das Feld in drei Ringen

### Ring 1 — GSC-MCP-Server

Die Kategorie ist 2026 von rund sechs auf über zwanzig aktive Projekte gewachsen.

| Anbieter | Art | Datenquelle | Preis |
|---|---|---|---|
| `AminForou/mcp-gsc` | Open Source, >500 Sterne | GSC API, live | kostenlos |
| `ahonn/mcp-server-gsc` | Open Source | GSC API, live | kostenlos |
| `seotesting-com/gsc-mcp-server` | Open Source, Anbieter-gestützt | GSC API | kostenlos |
| `better-search-console` | Open Source | **API → lokale SQLite**, SQL als Tools | kostenlos |
| OpenSEO | Open Source, auch gehostet | GSC API | kostenlos / 10 $ |
| GenieSeo | gehostet, 28 Tools (21 GSC + 7 GA4) | GSC API | Beta kostenlos |

**Der Boden ist kostenlos.** Wer nur „GSC in Claude" verkauft, konkurriert gegen null.

### Ring 2 — GSC-Warehouses mit Agentenzugang

Anbieter, die Daten dauerhaft speichern *und* einen MCP-Zugang haben:

| Anbieter | Historie | MCP | Analyse | Herkunft |
|---|---|---|---|---|
| **SEO Gets** | über 16 Monate hinaus | **ja**, `app.seogets.com/mcp`, ab Core-Plan | Reports, GA4 | US |
| **SEOTesting** | ja | **ja**, eigener GSC-MCP-Server | Zeitraumvergleich, CTR, Reports | UK |
| **GSC Wizard** | kontinuierlich gespeichert | teilweise | Reports | US |
| **SEO Stack** | ja | unklar | Reports | US |
| **Advanced GSC** | nein (Passthrough) | ja, 45 Tools, GSC + GA4 | Kannibalisierung, Vergleich | US |

**Das ist der unbequeme Teil:** Die im ersten Entwurf geplante Positionierung — „Historie über 16 Monate plus Agentenzugang" — ist von SEO Gets bereits besetzt und von SEOTesting weitgehend abgedeckt.

### Ring 3 — Google selbst

Der stärkste und am häufigsten übersehene Wettbewerber ist der **Bulk Data Export** der Search Console:

- schiebt **täglich die vollständigen Suchdaten** nach BigQuery
- **keine Zeilenlimits** — weder die 1.000 der Oberfläche noch die 25.000 der API
- **unbegrenzte Aufbewahrung**, nach Datum partitioniert
- Search Console berechnet dafür nichts; es fallen nur BigQuery-Kosten an
- Tabellen `searchdata_site_impression` und `searchdata_url_impression`, letztere mit Query **und** URL

Jeder technisch versierte Nutzer bekommt damit dauerhaft vollständige Daten für wenige Euro. Das entwertet „wir speichern deine Historie" als alleinstehendes Verkaufsargument.

## Prüfung der ursprünglichen Differenzierer

| # | Ursprünglich behauptet | Befund |
|---|---|---|
| 1 | Historie über 16 Monate | **gefallen** — SEO Gets, SEO Stack, GSC Wizard, SEOTesting; vor allem Googles eigener Bulk Export |
| 2 | Volle Auflösung ohne Sampling | **gefallen, aber gedreht** — siehe unten. Über die API ist es kein Vorteil; über den Bulk Export ist es einer |
| 3 | Deterministische Analyse-Engine | **hält** — Zeitraumvergleich und CTR-Analyse gibt es; die Zerlegung in Nachfrage/Ranking/Snippet, saisonbereinigte Anomalien mit Poisson-Behandlung und eine isoton geschätzte site-eigene CTR-Kurve fand sich bei keinem Anbieter |
| 4 | Proaktive Alerts | **hält im MCP-Feld** — kein MCP-Anbieter meldet von selbst. Klassische SEO-Werkzeuge tun es, aber nicht im Agentenkontext |
| 5 | EU-Hosting, AVV | **hält** — alle relevanten Anbieter sind US oder UK; kein Open-Source-Projekt liefert einen AVV |

Zwei von fünf gefallen, drei halten. Das ist zu wenig für ein Produkt, das gegen kostenlose Alternativen bestehen soll.

## Die Lücke

Beim Nachrechnen fällt etwas auf, das den Ausweg zeigt:

> **Ausnahmslos jeder Anbieter im Feld nutzt die Search Console API als Datenquelle.**

Damit erben alle dieselben Grenzen: rund 50.000 Zeilen pro Tag und Suchtyp, 25.000 pro Request, und eine Quote, die pro Cloud-Projekt geteilt wird. Auch wer die Daten anschließend speichert, speichert eine **Stichprobe** — die Top-N nach Klicks.

Googles Bulk Data Export hat keine dieser Grenzen. Er ist vollständig, kostet keine API-Quote und läuft von selbst. Was ihm fehlt, ist alles andere: keine Oberfläche, keine Analyse, keine Interpretation, kein Agentenzugang — und ein Einrichtungsschritt, der viele abschreckt.

**Niemand verbindet Googles vollständigen Datenexport mit einem Agentenzugang und einer rechnenden Analyse.** Das ist die Position.

## Der USP

> **Der einzige SEO-Agent, der auf Googles vollständigem Datenexport arbeitet statt auf der limitierten API.**
> Vollständige Daten statt Stichprobe. Eine Engine, die rechnet statt schätzt. Alarme, die sich von selbst melden. Betrieben in Deutschland.

Vier Aussagen, jede einzeln belegbar:

**1 — Vollständig statt Stichprobe.** Alle anderen speichern die Top-N der API. Wir arbeiten auf dem Bulk Export, der alles enthält außer den von Google anonymisierten Anfragen. Wie groß der Unterschied ist, ist an eigenen Daten gemessen: Bei `sc-domain:aip.aero` entfallen auf die 100 klickstärksten Suchanfragen **8,3 % der Klicks** — rund 92 % des Geschehens liegen darunter. Das ist keine Marketingaussage, sondern eine nachrechenbare Zahl.

**2 — Rechnen statt schätzen.** Änderungszerlegung in Nachfrage-, Ranking- und Snippet-Anteil, die sich exakt zum Gesamteffekt summiert; saisonbereinigte Anomalien mit korrekter Behandlung kleiner Zahlen; eine aus den eigenen Daten geschätzte CTR-Kurve statt einer Branchentabelle ([06-analyse-engine.md](06-analyse-engine.md)). Reproduzierbar und erklärbar — entscheidend für jeden, der eine Zahl in ein Meeting trägt.

**3 — Meldet sich von selbst.** Kein MCP-Anbieter im Feld tut das. Es ist der Schritt vom Werkzeug zum Dienst und die beste Begründung eines Abos.

**4 — In Deutschland betrieben.** Daten im Ruhezustand in Nürnberg, AVV, direkter Zugangsweg ohne US-Auftragsverarbeiter ([08-security-dsgvo.md](08-security-dsgvo.md)). Alle relevanten Wettbewerber sind US oder UK.

### Was der USP nicht behauptet

Nicht „mehr Tools" — Advanced GSC hat 45, wir haben 26 und wollen keine 45. Nicht „günstiger" — der Boden ist kostenlos, dort ist nichts zu gewinnen. Nicht „SEO-Komplettsuite" — keine Backlinks, kein Keyword-Volumen, kein SERP-Scraping.

## Folgen für die Architektur

Das ist kein Positionierungstext, sondern ein technischer Umbau. Er löst zugleich das größte offene Problem des bisherigen Entwurfs.

**Zweistufige Datenbeschaffung:**

| Zeitraum | Quelle | Warum |
|---|---|---|
| Vergangenheit (bis 16 Monate) | Search Console API, einmaliger Backfill | Der Bulk Export kennt keine Rückwirkung — er beginnt am Tag der Aktivierung |
| Ab Aktivierung | **Bulk Data Export** | vollständig, keine API-Quote, tägliche Lieferung |

**Was das aufräumt:** [04-sync-pipeline.md](04-sync-pipeline.md) bezeichnet die projektweit geteilte Google-Quote als „Engpass des Geschäftsmodells". Der Bulk Export verbraucht diese Quote nicht. Der Engpass reduziert sich auf den einmaligen Backfill je Property — und der ist endlich, statt mit jedem Kunden dauerhaft mitzuwachsen. Der laufende Delta-Sync entfällt weitgehend.

**Was es kostet:** Ein Einrichtungsschritt je Property, den nur ein **Property-Inhaber** in der Search Console vornehmen kann. Nutzer mit eingeschränkten Rechten scheiden dafür aus. Der Assistent führt durch die Einrichtung — das ist ein guter Anwendungsfall für ein interaktives MCP-App-Panel.

**Das macht die Planstruktur ehrlicher:**

| Plan | Datenquelle | Aussage |
|---|---|---|
| Starter | nur API | „wie alle anderen, aber betrieben" |
| Pro / Agency | API-Backfill **+ Bulk Export** | „vollständig — das kann sonst niemand" |

Damit trennt das eigentliche Unterscheidungsmerkmal die Pläne, nicht ein künstlicher Zeilendeckel.

## Offene Entscheidung

Wo landet der Bulk Export? Zwei Wege, beide gangbar, mit unterschiedlichen Folgen:

**A — In das BigQuery-Projekt des Kunden.** Wir lesen von dort. Die Daten bleiben beim Kunden, wir tragen keine BigQuery-Kosten. Dafür braucht jeder Kunde ein Google-Cloud-Projekt mit Abrechnung — spürbare Hürde, und für Agenturen je Kundenproperty erneut.

**B — In unser BigQuery-Projekt.** Der Kunde erteilt in der Search Console nur die Freigabe. Deutlich weniger Reibung, wir spiegeln täglich nach PostgreSQL und löschen in BigQuery. Dafür tragen wir die Kosten und die Datenschutzverantwortung — und die Daten fließen durch einen US-Anbieter, was mit Aussage 4 des USP in Spannung steht.

Variante B ist die bessere Konversion, Variante A die bessere Datenschutzgeschichte. Ein Mittelweg — B als Standard, A für Kunden mit strenger Beschaffung — ist wahrscheinlich richtig, verdoppelt aber den Einrichtungspfad. **Diese Entscheidung gehört vor Phase 2 getroffen**, weil sie Datenmodell und Onboarding berührt.

## Was zu prüfen bleibt

| Frage | Warum sie zählt |
|---|---|
| Hat SEO Gets Alerts? | Falls ja, schrumpft Aussage 3 des USP |
| Nutzt jemand bereits den Bulk Export als MCP-Quelle? | Falls ja, fällt Aussage 1 |
| Preise und Kontingente von SEO Gets und SEOTesting | Grundlage der Preisentscheidung in [07-billing.md](07-billing.md) |
| BigQuery-Kosten je Property und Monat bei Variante B | entscheidet über die Machbarkeit von B |
| Bulk Export bei Domain- vs. URL-Präfix-Properties | Einrichtungspfad kann sich unterscheiden |

Diese Punkte sind vor der Preisfestlegung und vor Phase 2 zu klären, nicht vor Phase 1 — der Eigenbedarf hängt an keinem davon.
