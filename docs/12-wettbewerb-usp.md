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

## Entschieden: Der Export bleibt beim Kunden

**Der Bulk Data Export liefert in das BigQuery-Projekt des Kunden. Wir lesen von dort.**

Die Alternative wäre gewesen, den Export in unser eigenes Projekt zu leiten — weniger Reibung im Onboarding, aber die Daten flössen durch einen US-Anbieter unter unserer Verantwortung, was Aussage 4 des USP untergräbt. Der gewählte Weg dreht das um: **Der Kunde wählt die Region seines Datasets selbst und kann EU wählen.** Damit stärkt die Entscheidung das Datenschutzargument, statt es zu verwässern.

### Kostenverteilung

Zwei bestätigte Eigenschaften von BigQuery machen den Weg tragfähig:

| Posten | Wer zahlt | Größenordnung |
|---|---|---|
| Speicher des Exports | **Kunde** | ~2 GB je Property und Jahr; die ersten 10 GB sind dauerhaft frei |
| Gescannte Bytes beim Auslesen | **wir** | Abfragekosten trägt das Projekt, das den Job ausführt — nicht das, in dem die Daten liegen |
| Der Export selbst | niemand | Search Console berechnet dafür nichts |

Für die meisten Kunden ist der Speicher damit **kostenlos** — eine Property braucht Jahre, um das Freikontingent von 10 GB zu füllen. Auf unserer Seite bleibt der tägliche Auszug bei einem Partitionsfilter auf ein einzelnes Datum im Bereich weniger Megabyte; das monatliche Freikontingent von 1 TiB deckt sehr viele Properties ab.

**Die Abfragen müssen partitionsgefiltert sein.** Google hat eigens einen Beitrag über BigQuery-Effizienz bei Search-Console-Exporten veröffentlicht, weil naive Abfragen die vollständige Tabelle scannen. Ein Auszug ohne `WHERE data_date = …` kostet bei einer gewachsenen Property das Hundertfache — und zwar uns.

### Zugriffsmodell

Bewusst **ohne** zusätzlichen OAuth-Scope. `bigquery.readonly` in den Zustimmungsdialog aufzunehmen, hieße einen weiteren Scope in der ohnehin kritischen Google-Verifizierung zu rechtfertigen ([02-auth.md](02-auth.md)). Stattdessen:

Der Kunde erteilt **unserem Dienstkonto** die Rolle `roles/bigquery.dataViewer` auf dem Dataset. Ein Eintrag im BigQuery-Freigabedialog, eine E-Mail-Adresse — kein Schlüsselaustausch, jederzeit vom Kunden widerrufbar, und für uns nur Leserechte auf genau dieses eine Dataset.

Auf unserer Seite braucht das Dienstkonto `roles/bigquery.jobUser` im eigenen Projekt, damit die Abfragen dort abgerechnet werden.

### Der Einrichtungsweg

Fünf Schritte, die der Kunde einmal je Property geht:

1. Google-Cloud-Projekt anlegen oder wählen und **Abrechnung aktivieren**
2. BigQuery API aktivieren
3. Googles Export-Dienstkonto die nötigen Rollen im Projekt geben
4. In der Search Console unter *Einstellungen → Bulk data export* Projekt-ID und **Dataset-Region (EU wählen)** eintragen
5. Unserem Dienstkonto `bigquery.dataViewer` auf dem Dataset erteilen

**Schritt 1 ist die eigentliche Hürde**, und sie ist nicht wegzuverhandeln: Search Console verlangt ein Projekt mit aktivierter Abrechnung, auch wenn die Nutzung vollständig im Freikontingent bleibt. Wer keine Kreditkarte hinterlegen will, kommt diesen Weg nicht.

Drei Konsequenzen daraus:

- **Der Starter-Plan funktioniert ohne Bulk Export**, rein über die API. Er ist damit nicht nur ein billigerer Plan, sondern der Weg für alle, die den Einrichtungsaufwand nicht gehen wollen.
- **Ein geführtes MCP-App-Panel** übernimmt die Anleitung — mit Prüfung nach jedem Schritt, statt einer Linkliste. Das ist der beste Anwendungsfall für eine interaktive Oberfläche im ganzen Produkt.
- **Agenturen richten ein Projekt für alle Kundenproperties ein**, nicht eines je Property. Das reduziert fünf Schritte je Property auf einen — und macht das Segment, das ohnehin das wichtigste ist, zum am leichtesten zu bedienenden.

### Rückfallweg

Bricht der Export ab — Abrechnung abgelaufen, Rechte entzogen, Dataset gelöscht —, erkennt der tägliche Auszug das an ausbleibenden Partitionen. Die Property fällt dann automatisch auf den API-Sync zurück, und der Nutzer wird benachrichtigt. Ein stillschweigend versiegender Datenstrom wäre der schlimmste Fehlerfall, weil er erst Wochen später auffällt und die Lücke dann nicht mehr zu schließen ist.

## Was zu prüfen bleibt

| Frage | Warum sie zählt |
|---|---|
| Hat SEO Gets Alerts? | Falls ja, schrumpft Aussage 3 des USP |
| Nutzt jemand bereits den Bulk Export als MCP-Quelle? | Falls ja, fällt Aussage 1 |
| Preise und Kontingente von SEO Gets und SEOTesting | Grundlage der Preisentscheidung in [07-billing.md](07-billing.md) |
| BigQuery-Kosten je Property und Monat bei Variante B | entscheidet über die Machbarkeit von B |
| Bulk Export bei Domain- vs. URL-Präfix-Properties | Einrichtungspfad kann sich unterscheiden |

Diese Punkte sind vor der Preisfestlegung und vor Phase 2 zu klären, nicht vor Phase 1 — der Eigenbedarf hängt an keinem davon.
