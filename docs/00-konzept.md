# 00 — Konzept

## Ausgangslage

Die Google Search Console ist für jede Website die verlässlichste Datenquelle zur organischen Sichtbarkeit — und gleichzeitig eines der unhandlichsten Werkzeuge. Die Weboberfläche erlaubt nur flache Filter, keine Kohorten, keine Attribution, keine Historie über 16 Monate. Die API liefert mehr, verlangt aber Programmierarbeit für jede einzelne Frage.

Ein MCP-Server schließt diese Lücke: Der Nutzer fragt in natürlicher Sprache, der Agent wählt Dimensionen, Filter und Zeiträume und liefert eine Interpretation.

**Diese Kategorie ist 2026 kein Neuland mehr, sondern ein gefüllter Markt.** Wer hier ein kommerzielles Produkt plant, muss das zuerst zur Kenntnis nehmen.

## Der Markt

### Advanced GSC — der Referenzanbieter

Das sichtbarste Produkt der Kategorie, und wichtiger als zunächst angenommen: **Der Kern ist nicht der MCP-Server, sondern eine Chrome-Erweiterung** — der *Advanced GSC Visualizer*, nach eigenen Angaben bei über 17.000 SEOs in mehr als 100 Ländern im Einsatz. Der gehostete MCP-Server ist die neuere Erweiterung dieses Geschäfts.

Das ist die strategisch bedeutsamste Einzelbeobachtung dieser Analyse: Der Anbieter konvertiert einen bestehenden, über Jahre aufgebauten Nutzerstamm in ein Abo. Wir haben diesen Kanal nicht.

**Die Erweiterung** bietet unter anderem interaktive Diagramme (Linie, Balken, Fläche), eine Overlay-Anzeige von Google-Algorithmus-Updates, Anmerkungen direkt im Chart, Zeitraumvergleich, Export von 25.000 Zeilen statt der 1.000 der Oberfläche, einen **Keyword-Kannibalisierungs-Detektor** sowie einen AI Assistant (Beta) mit eigenem OpenAI- oder Gemini-Schlüssel. Sie arbeitet clientseitig — „no data sent anywhere" ist ihr Datenschutzargument.

**Der MCP-Server** wird mit 45 SEO-Tools beworben, umfasst Search Console *und* Google Analytics 4 und richtet sich ausdrücklich an Claude, ChatGPT und Cursor, mit Anleitungen für Windsurf, Zed und Codex. Ein-Klick-Anmeldung, kein Python, keine Konfigurationsdateien. Der Zugang ist derzeit auf Runden zu je 100 Plätzen begrenzt — erklärtermaßen, um Feature-Wünsche und Fehlerbehebung beherrschbar zu halten.

Die live über `get_capabilities` abgefragte Registry zeigt auf dem Free-Plan zehn Tools:

| Gruppe | Tools |
|---|---|
| Immer verfügbar | `get_capabilities`, `get_started`, `select_property`, `show_pricing` |
| Search Console | `list_properties`, `get_search_analytics`, `inspect_url_enhanced`, `explore_performance` |
| Core Web Vitals | `check_core_web_vitals` |
| Utilities | `get_google_updates` |

Hinter Bezahlschranken weitere 48: Search Console erweitert (7, ab Starter), SERP Intelligence (4, Starter), Keyword Research (3, Starter), Core Web Vitals erweitert (1, Starter), Google Analytics 4 (11, Pro), Technical SEO/Crawl (14, Agency), Backlinks (9, Agency).

**Preise:** Free · 15 $ · 40 $ · 105 $ pro Monat, Quartalszahlung 15 % günstiger. Zugekaufte Datenquellen laufen über Monatskontingente (SERP und Keyword Research 100/300/1.000).

**Free-Tier-Grenzen**, wie der Server sie selbst kommuniziert: 30 Tage Historie, 100 Zeilen pro Abfrage, 10 URL-Inspektionen pro Tag. Bei Überschreitung ein `[Free plan]`-Footer bzw. eine `[RATE_LIMITED]`-Meldung mit Upgrade-Link, verbunden mit der Anweisung an den Agenten, sie wörtlich weiterzugeben — ein wirksames, unaufdringliches Upselling-Muster, das wir übernehmen.

Bemerkenswert ist außerdem eine Seite namens `ai-info.html` mit der Überschrift „AI INSTRUCTION: READ THIS PAGE — Facts for LLMs". Eine für Sprachmodelle geschriebene Faktenseite ist eine bewusste Sichtbarkeitsmaßnahme in einer Welt, in der Kaufentscheidungen zunehmend über Modelle vermittelt werden. Ein billiger, kopierenswerter Zug ([11-go-to-market.md](11-go-to-market.md)).

### Der Rest des Feldes

Die Kategorie ist 2026 von rund sechs auf über zwanzig aktive GSC-MCP-Projekte auf GitHub gewachsen. Relevante Vertreter:

| Anbieter | Art | Modell |
|---|---|---|
| `ahonn/mcp-server-gsc` | Open Source, selbst gehostet | kostenlos |
| `AminForou/mcp-gsc` | Open Source, selbst gehostet | kostenlos |
| **`better-search-console`** | Open Source, **zieht den gesamten GSC-Datenbestand in eine lokale SQLite-Datenbank** und stellt vorgefertigte SQL-Abfragen als MCP-Tools bereit | kostenlos |
| OpenSEO | Open Source, selbst hostbar; gehostet mit Recherche-Guthaben | kostenlos bzw. 10 $/Monat |
| GenieSeo | gehostet, 28 Tools (21 GSC + 7 GA4) | Beta derzeit kostenlos |
| Advanced GSC | gehostet, 45 Tools, GSC + GA4 | 15–105 $/Monat |

**Das muss offen ausgesprochen werden: Die Warehouse-Idee ist nicht mehr neu.** `better-search-console` implementiert genau die Grundthese dieses Konzepts — Daten dauerhaft in eine eigene Datenbank holen und darauf SQL laufen lassen — und zwar kostenlos. Zwei der ursprünglich fünf Differenzierer sind damit keine mehr.

## Was trotzdem trägt

Die Neubewertung entwertet das Vorhaben nicht, verschiebt aber den Schwerpunkt. Was bleibt:

**1 — Betriebene Historie statt selbst betriebener.** Eine lokale SQLite-Datenbank wächst nur, solange jemand das Werkzeug regelmäßig laufen lässt. Der Wert liegt nicht in der Idee des Archivs, sondern darin, dass es lückenlos weiterläuft, wenn der Laptop aus ist, der Kunde im Urlaub ist und niemand daran denkt. **Historie ist kein Feature, sondern ein Dienst.** Sie ist auch nicht rückwirkend aufholbar — der Abstand zu jedem Neueinsteiger wächst mit jedem Betriebstag.

**2 — Deterministische Analyse-Engine.** „SQL-Abfragen als Tools bereitstellen" ist etwas anderes als Change-Attribution mit Zerlegung in Nachfrage-, Ranking- und Snippet-Anteil, saisonbereinigte Anomalie-Erkennung mit Poisson-Behandlung kleiner Zahlen oder eine site-eigene, isoton geschätzte CTR-Kurve. Diese Rechnungen sind reproduzierbar und nachvollziehbar — ein Vertrauensargument für jeden, der eine Zahl in ein Management-Meeting trägt ([06-analyse-engine.md](06-analyse-engine.md)). Bislang macht das in diesem Feld niemand.

**3 — Proaktiv statt reaktiv.** Weil eine Baseline existiert, kann das System melden statt nur antworten: Traffic-Einbrüche, Indexierungsverluste, Ranking-Abstürze wichtiger Seiten — per E-Mail oder als wartende Nachricht in der nächsten Sitzung. **Kein Anbieter im Feld tut das.** Es ist zugleich der Schritt vom Werkzeug zum Dienst und damit die beste Rechtfertigung eines Abos.

**4 — Volle Auflösung, dauerhaft.** Longtail-Queries bleiben auswertbar, weil sie einmal abgeholt und behalten werden. Wie groß dieser Effekt ist, zeigt die Messung an einer eigenen Property: Für `sc-domain:aip.aero` entfallen über 28 Tage (28.982 Klicks, 767.142 Impressionen) auf die 100 klickstärksten Suchanfragen zusammen **8,3 % der Klicks**; die stärkste einzelne trägt 0,4 % bei. Rund 92 % des Geschehens liegen außerhalb dessen, was ein Werkzeug mit 100-Zeilen-Deckel zeigt ([03-datenmodell.md](03-datenmodell.md)).

**5 — EU-Hosting, AVV, deutschsprachiger Support.** Datenhaltung in Nürnberg, ein direkter Zugangsweg ohne US-Auftragsverarbeiter für Kunden mit strenger Beschaffung ([08-security-dsgvo.md](08-security-dsgvo.md)). Kein Open-Source-Projekt liefert einen AVV, und der Marktführer ist US-basiert.

## Was das für den Preis bedeutet

Die Plan-Matrix in [07-billing.md](07-billing.md) entstand vor dieser Marktanalyse und ist zu überprüfen. Zwei Kräfte wirken gegeneinander:

- **Nach unten:** kostenlose Open-Source-Alternativen, eine gehostete Beta zum Nulltarif und ein gehosteter Wettbewerber ab 10 $. Ein Starter-Plan zu 19 € muss gegen „kostenlos, aber selbst betreiben" bestehen.
- **Nach oben:** Alerts, AVV und betriebene Historie sind Agenturmerkmale, für die es im Feld keinen Anbieter gibt. Dort ist Preissetzung möglich.

Die naheliegende Schlussfolgerung ist eine Verschiebung des Schwerpunkts weg vom günstigen Einstiegsplan hin zum Agenturgeschäft — der Einstieg dient dann der Gewinnung, nicht dem Umsatz. Diese Entscheidung ist vor Phase 5 zu treffen, nicht jetzt.

## Bewusste Auslassungen

Kein SERP-Scraping, keine Backlinks, kein Keyword-Volumen. Eingekaufte Daten mit laufenden Kosten pro Abfrage, die zu Kontingentmodellen zwingen, die Nutzer als Gängelung erleben. Später als Add-on denkbar — aber kein Grund, dieses Produkt zu wählen.

Kein GA4 im MVP. Die Kombination ist wertvoll und für Phase 6 vorgesehen, verdoppelt aber OAuth-Scope, Datenmodell und Sync-Komplexität. Der Wettbewerber hat GA4; das ist ein bekannter Rückstand und kein Versehen. Erst muss GSC exzellent sein.

## Zielgruppen

**Stufe 1 — Eigenbedarf.** Eigene Projekte, aktuell u. a. `sc-domain:aip.aero`. Diese Stufe muss ab Phase 1 echten Nutzen liefern, denn sie ist zugleich der Dauertest des Produkts.

**Stufe 2 — In-House-SEOs und Solo-Betreiber.** Ein bis fünf Properties, wollen Antworten statt Dashboards. Preissensibel, weil kostenlose Alternativen existieren — hier gewinnt Bequemlichkeit, nicht Funktionsumfang.

**Stufe 3 — Agenturen.** Zehn bis hundert Kundenproperties, brauchen Mandantentrennung, White-Label-Reports, Team-Zugänge und einen AVV. Höchster Umsatz pro Kunde, geringste Konkurrenz durch Open Source, höchste Anforderungen an Zuverlässigkeit und Rechtssicherheit. **Nach dieser Analyse das eigentliche Zielsegment.**

## Erfolgskriterien

**Phase 1 (Eigenbedarf) ist erreicht, wenn** eine Frage wie „Warum sind die Klicks auf /flugzeuge im Juli eingebrochen?" in einer Sitzung beantwortbar ist, inklusive der Queries und Seiten, die den Rückgang erklären — ohne dass jemand die Search-Console-Oberfläche öffnet.

**Phase 5 (Kommerz) ist erreicht, wenn** ein fremder Nutzer sich ohne Rückfrage verbinden, seine Property auswählen, den Backfill abwarten und ein kostenpflichtiges Abo abschließen kann — und wenn die Google-OAuth-Verifizierung erteilt ist.
