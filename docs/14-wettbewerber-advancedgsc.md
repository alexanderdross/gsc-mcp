# 14 — Wettbewerberdossier: Advanced GSC

Vollerhebung von `advancedgsc.com` am 03.11.2026. Dieses Dokument löst die in [12-wettbewerb-usp.md](12-wettbewerb-usp.md) benannte Einschränkung auf, dass die Marketingseiten dieses Anbieters nicht lesbar waren, und beantwortet zwei der dort offenen Prüffragen.

## Warum dieser Anbieter ein eigenes Dokument bekommt

Von allen Anbietern im Marktscan ist Advanced GSC der einzige, der gleichzeitig drei Dinge mitbringt: einen etablierten Verteilkanal (Chrome-Erweiterung mit über 17.000 Nutzern), das bekannteste Open-Source-Projekt der Kategorie (`AminForou/mcp-gsc`) und ein bereits verkauftes gehostetes MCP mit öffentlicher Preisliste. Die anderen haben jeweils eines davon. Wer unsere Preise, unsere Tool-Auswahl und unsere Positionierung festlegt, legt sie gegen diesen Anbieter fest.

## Erhebung und Methodik

| | |
|---|---|
| Datum | 03.11.2026 |
| Quelle | `https://www.advancedgsc.com/sitemap.xml` plus Linkextraktion aus allen abgerufenen Seiten |
| Umfang | 42 Sitemap-URLs, dazu 3 verlinkte, aber nicht gelistete Seiten |
| Antwortstatus | 45 von 45 HTTP 200 |
| Verfahren | Serverseitiges HTML, Textextraktion ohne Skriptausführung |

Die Seiten sind serverseitig gerendert, der Volltext ist ohne Browser lesbar. Nicht erfasst sind damit nur Inhalte, die ausschließlich clientseitig nachgeladen werden: die FAQ-Antworten in den Akkordeons, die Glossareinträge und die interaktiven Rechenwidgets. Die Fragen selbst, die Überschriften und der gesamte Fließtext liegen vor.

**Was diese Erhebung nicht leistet:** Sie zeigt, was der Anbieter über sich sagt, nicht was sein Produkt tut. Die in [12-wettbewerb-usp.md](12-wettbewerb-usp.md) zitierte Live-Abfrage der Tool-Registry bleibt die belastbarere Quelle für den Funktionsumfang. Beide Quellen widersprechen sich nicht: 45 Tools dort, 45 Tools hier.

## Der Anbieter

Amin Foroutan, SEO-Berater mit nach eigener Angabe über zehn Jahren Erfahrung und Fortune-500-Mandaten. Drei Erzeugnisse, zeitlich gestaffelt:

| Zeitpunkt | Erzeugnis | Reichweite |
|---|---|---|
| November 2024 | Chrome-Erweiterung "Advanced GSC Visualizer" | 17.000+ Nutzer, 4,6 Sterne, 100+ Länder |
| März 2025 | Open Source `github.com/AminForou/mcp-gsc` | 600 bis 800 GitHub-Sterne (Angaben auf der Site schwanken) |
| 2026 | gehostetes MCP unter `/mcp` | "Runde zwei", 65 von 100 Plätzen belegt |

Die Reihenfolge ist aufschlussreich. Die Site beschreibt den Weg selbst: das Open-Source-Projekt bekam Zugkraft, Nutzer fragten nach einem einfacheren Einstieg, daraus wurde das gehostete Produkt. Das ist derselbe Weg, den wir nicht gehen können, weil wir weder Erweiterung noch Open-Source-Vorlauf haben.

Technisch: Next.js, Sanity als CMS, Bilder über `cdn.sanity.io`.

## Das gehostete MCP

Die Verkaufsseite `/mcp` **steht nicht in der Sitemap**. Sie hat eigene Navigation (Use cases, Pricing, About, Contact), eigenes Branding ("Advanced GSC MCP") und eigenen Footer. Faktisch zwei Sites unter einer Domain.

### Preise

| | Starter | Pro | Max |
|---|---|---|---|
| Monatlich | 15 USD | 40 USD | 105 USD |
| Properties | 3 GSC | 10 GSC + 10 GA4 | unbegrenzt (fair use) |
| Sitze | 1 | 3 | 5 |
| SERP-Abfragen | 200/Monat | 500/Monat | 1.500/Monat |
| Keyword-Recherche | 100/Monat | 300/Monat | 1.000/Monat |
| Core Web Vitals | 100/Tag | 300/Tag | 1.000/Tag |
| Schema-Validierung | Server-HTML | + JS-Rendering (100/Monat) | + JS-Rendering (400/Monat) |
| Keyword-Gap | nein | 40/Monat | 150/Monat |
| Crawler, Backlinks | nein | nein | ja (Backlinks 250/Monat) |
| Google-Konten | nicht beziffert | nicht beziffert | 3 |

Quartalszahlung 15 Prozent günstiger. Preise ohne Steuer. Eine kostenlose Stufe mit Einschränkungen existiert, ohne Kreditkarte. Oberhalb von Max führt ein Formular zu Individualangeboten mit CMS-Anbindung (WordPress, Contentful, Sanity, Webflow).

Der Hinweis "Prices have already gone up once. Lock today's price by subscribing now and staying subscribed" zeigt, dass die Preise nach oben kalibriert werden und Bestandskunden ihren Satz behalten.

### Verpackungslogik

Drei Hebel staffeln die Pläne, und das ist die eigentliche Lehre für [07-billing.md](07-billing.md):

1. **Property-Zahl** (3 / 10 / unbegrenzt) trennt Einzelperson, Team und Agentur.
2. **Datenquellen** trennen die Stufen inhaltlich: Starter nur GSC, Pro plus GA4, Max plus Crawler und Backlinks. Das ist dieselbe Mechanik, mit der wir API gegen Bulk Export staffeln wollen, nur über Breite statt über Tiefe.
3. **Verbrauchskontingente** auf alles, was externe Kosten verursacht (SERP, Keywords, CWV, JS-Rendering). Nicht gedeckelt ist, was nur die eigene Datenbank kostet.

Punkt 3 ist handwerklich sauber und bei uns bislang nicht vorgesehen: Unsere Plan-Matrix staffelt über Datenquelle und Property-Zahl, nicht über Abfragekontingente. Da wir keine Fremdkosten pro Abfrage haben außer gescannten BigQuery-Bytes, ist das vertretbar. Aber die gescannten Bytes sind genau so ein Posten, und [12-wettbewerb-usp.md](12-wettbewerb-usp.md) benennt sie als unsere Kosten. Ein Kontingent auf die Tiefe historischer Abfragen wäre die ehrliche Entsprechung.

### Vertriebsmechanik

Die Seite arbeitet durchgehend mit künstlicher Verknappung:

> "Founding round sold out. Round two is open. 35 of 100 spots left."

Begründet mit einem persönlichen Versprechen: bei 100 Nutzern werde ein Feature-Wunsch in derselben Woche gebaut, ein Fehler am selben Tag behoben, und das überlebe keine paar hundert Nutzer. Dazu die Preisgarantie für Bestandskunden.

Das ersetzt Vertrieb vollständig. Für unsere Phase 1, in der wir ohnehin Eigenbedarf deckend und mit wenigen Pilotkunden starten, ist das ein direkt übernehmbares Muster und passt zu [11-go-to-market.md](11-go-to-market.md): Die Begrenzung ist bei uns nicht künstlich, sondern echt, weil jede Property einen Einrichtungsschritt des Inhabers braucht.

### Onboarding

Drei Schritte, nach eigener Angabe unter drei Minuten:

1. Google-Anmeldung, die die GSC-Berechtigung direkt mitanfordert, ohne getrennten OAuth-Schritt.
2. Plan wählen und Properties aktivieren, begrenzt durch das Plan-Limit.
3. KI-Werkzeug verbinden: ein Klick für Claude.ai, ChatGPT und Claude Desktop, Copy-Paste plus Video für Cursor, Windsurf, Zed und Codex.

**Das ist der härteste Vergleichspunkt.** Unser Weg zum vollständigen Datenstand verlangt fünf Schritte je Property, darunter ein Google-Cloud-Projekt mit aktivierter Abrechnung ([12-wettbewerb-usp.md](12-wettbewerb-usp.md), Abschnitt Einrichtungsweg). Drei Minuten gegen eine Kreditkartenhinterlegung ist kein Vergleich, den wir gewinnen. Die Antwort darauf ist nicht, den Einrichtungsweg zu beschönigen, sondern der Starter-Plan ohne Bulk Export: Er muss unser Drei-Minuten-Weg sein, und der Aufstieg zum vollständigen Datenstand muss sich als bewusste Entscheidung anfühlen, nicht als Voraussetzung.

### Was auf der ganzen Site fehlt

**Kein Wort zum Bulk Data Export.** Nicht auf der Verkaufsseite, nicht in den 23 Dokumentationsseiten, nicht in den acht Blogbeiträgen. Der Beitrag, der fünf Verbindungswege zur GSC API vergleicht, führt BigQuery Export als vierten Weg auf und empfiehlt ihn ausdrücklich ab:

> "If you do not already work in SQL, BigQuery is probably not your tool. (...) For most SEOs who want to pull keyword data and run analysis, the overhead does not match the use case."

Der Anbieter kennt den Weg, hat ihn geprüft und sich gegen ihn entschieden. Sein Produkt arbeitet gegen die API und bleibt bei deren 25.000-Zeilen-Decke.

**Das beantwortet eine der offenen Fragen aus [12-wettbewerb-usp.md](12-wettbewerb-usp.md).** Aussage 1 des USP hält gegen diesen Anbieter, und zwar nicht zufällig, sondern weil er sich architektonisch anders entschieden hat. Das ist belastbarer als eine Lücke, die jemand morgen schließen könnte.

## Das Content-Fundament

### Blog

Acht Beiträge, alle zwischen 21. März und 3. April 2026, alle von einem Autor. Klassisches Hub-and-Spoke mit dichter interner Verlinkung, jeder Beitrag mit Glossar und FAQ-Akkordeon, 9 bis 18 Minuten Lesezeit.

| Datum | Beitrag | Rolle |
|---|---|---|
| 25.03. | Was GSC an Daten zurückhält | Pillar |
| 28.03. | Fünf Wege zur GSC API im Vergleich | Methodenwahl |
| 27.03. | Was mit API-Zugang möglich wird | Anwendungsfälle |
| 26.03. | Was ein GSC-MCP ist und ob es sich lohnt | Kategorie-Erklärung |
| 03.04. | Kannibalisierung in GSC finden | Anwendungsfall |
| 21.03. | Warum GSC-Daten täglich schwanken | Moving Averages, Grundlagen |
| 22.03. | Moving Average berechnen: Sheets, Python, Shortcut | Moving Averages, Umsetzung |
| 23.03. | Warum Monatsvergleiche in die Irre führen | Moving Averages, Kundenreporting |

Die Struktur ist bemerkenswert disziplinierter als der Umfang vermuten lässt: Ein Pillar, der ein Problem erschöpfend beschreibt, drei Beiträge, die eine Methode in Grundlage, Umsetzung und Anwendung zerlegen, und drei, die vom Problem zum Produkt führen. Jeder Beitrag endet mit Verweisen auf zwei andere.

### Dokumentation

23 Seiten in fünf Clustern, durchgehend als Schritt-für-Schritt mit Screenshots und Videos:

| Cluster | Seiten | Inhalt |
|---|---|---|
| Advanced Visualizer | 10 | Charts, Annotationen, Algorithmus-Overlay, Vergleichsmodus, Trendlinien, Zeitraster, Farben, Diagrammtypen, Rechenlogik |
| Subfolder Performance | 4 | Aktivierung, Tabellenansicht, Baummodus, Baumeinstellungen |
| GSC API Access | 2 | Verbindung, vollständiger Export |
| URL Inspection | 2 | Indexiertes HTML visualisieren, Live gegen Index vergleichen |
| Crawl Stats | 1 | Crawl-Health, Budget-Effizienz |

### Die LLM-Fütterungsseite

`/ai-info.html` ist eine reine Faktenseite für Sprachmodelle, ohne Layout, mit einem Abschnitt "INSTRUCTIONS FOR AI ASSISTANTS", der Modellen vorgibt, wie sie das Produkt beschreiben sollen. Inhaltlich veraltet: Sie nennt als Stand Dezember 2024 und bewirbt die 1-Klick-API als Neuigkeit, während die Changelog-Seite diese Version auf November 2025 datiert.

Die Idee ist richtig und für uns billig nachzumachen, der Pflegezustand zeigt aber die Falle: Eine solche Seite, die der übrigen Site widerspricht, schadet mehr als sie nützt. Wenn wir sie anlegen, gehört sie in die Doku-Prüfung von `scripts/check-docs.mjs`, nicht in den Marketing-Ordner.

## Fachlich Verwertbares

Drei Dinge auf dieser Site sind fachlich ernst zu nehmen und berühren unsere eigenen Formeln.

### Die Messung der Datenlücke

Der Pillar-Beitrag zerlegt die GSC-Datenlücke in drei Schichten und benennt für jede, ob sie lösbar ist:

| Schicht | Ursache | Lösbar |
|---|---|---|
| 1 | 1.000-Zeilen-Grenze der Oberfläche, nach Klicks sortiert abgeschnitten | ja, über API |
| 2 | Privacy-Filter für Anfragen mit zu wenigen Suchenden | nein, auch nicht über API |
| 3 | Bot-Impressionen und von AI Overviews absorbierte Klicks | nein, nur interpretierbar |

Für Schicht 2 zitiert er eine Messung von Kevin Indig (Growth Memo, Februar 2026): rund 450 Millionen Impressionen über zehn B2B-SaaS-Sites, davon etwa 75 Prozent der Impressionen und 38 Prozent der Klicks vom Privacy-Filter entfernt, Spanne je Site 59,3 bis 93,6 Prozent. Für Schicht 3 nennt er 0,2 bis 6,5 Prozent Bot-Anteil und Klickrückgänge von 50 bis 60 Prozent bei Anfragen mit AI Overview.

Die genannte Messmethode ist eine Division aus zwei getrennten API-Aufrufen: Impressionen der Query-Dimension geteilt durch Impressionen des Aggregat-Endpunkts ergibt die Überlebensrate des Filters.

**Das ist genau unser Sammelposten.** [03-datenmodell.md](03-datenmodell.md) führt `query_id = 0` als Auffangposten für Googles anonymisierte Anfragen, und die Invariante `SUM(fact_query) = fact_totals` je Tag erzwingt, dass er stimmt. Wo der Wettbewerber die Lücke aus zwei separaten Requests schätzt und mit "das lässt sich nicht zurückholen" endet, führen wir sie pro Tag als geprüfte Zahl mit.

Dreierlei folgt daraus:

- **Der Beitrag ist die Vorlage für unseren wichtigsten Marketingtext.** Er beschreibt das Problem erschöpfend und bietet keine Lösung. Unser Text ist die Fortsetzung, nicht die Gegenrede.
- **Die Zahl 75 Prozent ist nicht unsere Zahl.** Sie misst Schicht 2, die auch wir nicht schließen. Unsere Messung bei `sc-domain:aip.aero` (8,3 Prozent der Klicks auf den 100 klickstärksten Anfragen, rund 92 Prozent darunter) misst Schicht 1, und die schließen wir vollständig. Die beiden Zahlen dürfen nie vermischt werden, sonst versprechen wir, was wir nicht halten.
- **Schicht 3 ist ein offener Produktraum.** Niemand im Feld trennt Bot-Impressionen oder AIO-Effekte aus der CTR. Unsere saisonbereinigte Anomalie-Erkennung aus [06-analyse-engine.md](06-analyse-engine.md) ist das nächstgelegene Werkzeug dafür.

### Kannibalisierungs-Scoring

Der Anbieter veröffentlicht seine Schwellenwerte:

| Schwere | Positionsdifferenz | Impressionsverhältnis | Empfehlung |
|---|---|---|---|
| Hoch | unter 3 | über 0,5 | sofort beheben |
| Mittel | unter 5 | über 0,3 | bei kommerziellen Anfragen beheben |
| Niedrig | alles andere | alles andere | beobachten |

Dazu eine geschätzte Klickrückgewinnung über eine CTR-Kurve mit festen Werten: Position 1 rund 28 Prozent, Position 2 rund 15, Position 3 rund 11, Position 4 rund 8.

**Hier liegt ein konkreter Vorsprung.** Das ist eine Branchentabelle, keine Messung. [06-analyse-engine.md](06-analyse-engine.md) schätzt die CTR-Kurve isoton aus den eigenen Daten der jeweiligen Site. Für eine Site mit markenlastigem Anfrageprofil liegt die tatsächliche Kurve weit über der Branchentabelle, für eine informationslastige darunter. Die Schwellenwerte selbst sind brauchbar und als Startpunkt übernehmbar, die Potenzialschätzung darauf ist es nicht.

Für unser Kannibalisierungs-Tool in [05-tools.md](05-tools.md) heißt das: dieselben zwei Faktoren (Positionsnähe, Impressionsverteilung), aber die Potenzialrechnung gegen die site-eigene Kurve. Und weil wir Zeitreihen haben statt eines Zeitfensters, können wir zusätzlich sagen, ob ein Konflikt entsteht, besteht oder sich auflöst. Das kann der Wettbewerber nicht, weil er je Abfrage ein Fenster von 90 bis 180 Tagen zieht.

### Glättungslogik

Die Dokumentationsseite zur Rechenlogik ist ungewöhnlich offen und deckt sich erfreulich mit unseren eigenen Regeln:

- Gleitender Durchschnitt als nachlaufendes Fenster, das am aktuellen Punkt endet. Die ersten `period - 1` Werte sind `null`, nicht 0, damit die Linie nicht bei null beginnt.
- Trendlinie als gewöhnliche Kleinste-Quadrate-Regression über laufende Indizes.
- **Erst aggregieren, dann rechnen.** Klicks und Impressionen werden je Periode summiert, CTR wird als Summe Klicks geteilt durch Summe Impressionen neu gebildet, Position wird je Periode gemittelt.

Der dritte Punkt ist dieselbe Regel, die CLAUDE.md als Invariante führt: CTR nie gespeichert, immer berechnet. Dass ein Wettbewerber unabhängig darauf kommt und es dokumentiert, bestätigt, dass die Regel richtig ist, und entzieht ihr gleichzeitig den Wert als Unterscheidungsmerkmal. Unser Vorsprung liegt bei der Position: Der Anbieter mittelt sie je Periode, wir gewichten sie mit Impressionen. Bei einer Periode mit sehr ungleich verteilten Impressionen ist der gemittelte Wert schlicht falsch.

### Scores, die keine Messung sind

Zwei Kennzahlen der Crawl-Stats-Analyse, mit offengelegter Formel:

```
Crawl-Health      = 100 - (5xx% × 3) - (4xx% × 1) - (3xx% × 0,3)
Budget-Effizienz  = (Erfolg% × 0,5) + (HTML% × 0,5) - (Redirect% × 0,5)
```

Die Gewichte sind frei gewählt und werden nicht begründet. Als Produktidee funktioniert das trotzdem: eine Zahl, die man in ein Meeting tragen kann. Für uns ist es ein Gegenbeispiel. Wir verkaufen nachrechenbare Zahlen, und eine Kennzahl mit willkürlichen Gewichten ist das Gegenteil. Wenn wir einen Health-Score bauen, muss jedes Gewicht begründet sein, oder er heißt nicht Score.

## Bewertung gegen unsere Positionierung

### Was die Erhebung an [12-wettbewerb-usp.md](12-wettbewerb-usp.md) ändert

| Aussage des USP | Stand gegen Advanced GSC |
|---|---|
| 1 — Vollständig statt Stichprobe | **bestätigt**, und architektonisch abgesichert: der Anbieter hat den Bulk Export geprüft und verworfen |
| 2 — Rechnen statt schätzen | **teils bestätigt, teils geschrumpft**: Glättungs- und Aggregationslogik sind bei ihm korrekt, die CTR-Kurve ist eine Branchentabelle, Change-Attribution fehlt vollständig |
| 3 — Meldet sich von selbst | **bestätigt**: nichts auf der Site deutet auf Alerts hin |
| 4 — In Deutschland betrieben | **bestätigt**: US-Anbieter, keine Angaben zu Datenresidenz oder AVV, Datenschutzerklärung bezieht sich ausschließlich auf die Erweiterung |

Die Datenschutzerklärung ist dabei ein eigener Befund: Sie verspricht durchgehend, dass alle Verarbeitung clientseitig im Browser stattfindet und keine Daten an externe Server gehen. Für die Erweiterung mag das stimmen. Für ein gehostetes MCP, das GSC- und GA4-Daten serverseitig abruft, kann es nicht stimmen. Es gibt keine getrennte Erklärung für das MCP-Produkt. Für einen Kunden mit Beschaffungsprüfung ist das ein Ausschlussgrund, und für uns ein Argument, das wir nicht einmal zuspitzen müssen.

### Wo er uns schlägt

Nichts davon ist durch bessere Architektur aufzuholen:

- **Verteilkanal.** 17.000 Erweiterungsnutzer, die er kostenlos in das Bezahlprodukt leiten kann.
- **Reputation.** Search Engine Land, Aleyda Solís, Brodie Clark, Tory Gray. Namen, die in dieser Nische zählen.
- **Zeit am Markt.** Sein MCP verkauft, unser Code wartet auf die Google-Verifizierung.
- **Einstiegspreis.** 15 USD setzt die Erwartung für "ein MCP für Search Console".
- **Einrichtungsaufwand.** Drei Minuten gegen unsere fünf Schritte mit Abrechnungspflicht.
- **Fertiger Content.** Acht Beiträge, 23 Doku-Seiten, alles vorhanden.

### Die Schlussfolgerung

Breite gegen Tiefe, und er hat die Breite gewählt. 45 Tools über sechs Datenquellen, gebaut von einer Person. Das ist keine Kritik an ihm, sondern die Beschreibung einer Wahl, die eine Flanke öffnet: Pro Tool kann dort wenig Tiefe liegen.

Unsere Antwort kann nicht "auch 45 Tools" sein und nicht "günstiger". Sie muss lauten: wenige Tools, deren Zahlen stimmen, auf Daten, die vollständig sind, in einem Land, dessen Beschaffungsprüfung man übersteht. Das deckt sich mit dem, was [12-wettbewerb-usp.md](12-wettbewerb-usp.md) bereits festhält. Die Erhebung ändert die Positionierung nicht, sie belegt sie.

## Handwerkliche Mängel

Nicht aus Schadenfreude festgehalten, sondern weil jeder Punkt eine Prüfung ist, die wir uns selbst auferlegen sollten.

| Befund | Prüfung bei uns |
|---|---|
| `/mcp`, `/updates`, `/ai-info.html` fehlen in der Sitemap. Die Verkaufsseite einer SEO-Site ist nicht gelistet | Sitemap gegen die tatsächliche Seitenliste prüfen, nicht generieren und hoffen |
| `[@portabletext/react] Unknown block type "codeBlock"` steht sichtbar im Fließtext von mindestens zwei Seiten. Codeblöcke werden nicht ausgeliefert, obwohl der Text auf Formeln verweist | gerenderte Ausgabe prüfen, nicht nur die Quelle. `scripts/render-check.mjs` tut das für die Übersichtsseite |
| Ein Satz ist mitten im Wort von einem eingeschobenen Video zerschnitten ("Google Cloud Cons ... ole") | dasselbe |
| Die Startseite liefert den Testimonial-Block dreifach aus: 235 KB HTML für etwa 15 KB Text | Nutzlast gegen Inhalt messen |
| `/ai-info.html` nennt Dezember 2024 und widerspricht der Changelog-Seite | jede Faktenseite in die Konsistenzprüfung aufnehmen |
| Drei Sitemap-Einträge tragen denselben `lastmod`-Zeitstempel | `lastmod` aus dem Inhalt ableiten, nicht aus dem Build |

Der zweite Punkt ist der lehrreichste: Auf der Seite, die die Rechenformeln dokumentiert, fehlen genau die Codeblöcke mit den Formeln. Der Text verweist auf etwas, das nicht ausgeliefert wird. Das ist der Fehler, den unsere Übersichtsseite durch `render-check.mjs` nicht machen kann.

## Offene Punkte

Was diese Erhebung nicht beantwortet, in der Reihenfolge, in der es die Preisentscheidung aufhält:

| Frage | Woher die Antwort kommt |
|---|---|
| Welche 45 Tools genau, mit welchen Parametern? | Live-Abfrage der Registry, nicht die Marketingseite |
| Antwortqualität bei großen Properties | Testzugang auf der kostenlosen Stufe |
| Preise und Kontingente von SEO Gets und SEOTesting | eigene Erhebung, noch offen aus [12-wettbewerb-usp.md](12-wettbewerb-usp.md) |
| Hat SEO Gets Alerts? | noch offen, berührt Aussage 3 des USP |
| Nutzt jemand im Feld den Bulk Export als Quelle? | für Advanced GSC beantwortet (nein), für SEO Gets und SEOTesting offen |

Die ersten beiden sind vor der Preisfestlegung in [07-billing.md](07-billing.md) zu klären. Die letzten drei stehen bereits in [12-wettbewerb-usp.md](12-wettbewerb-usp.md) und bleiben dort.

## Anhang: Erfasste Seiten

45 Seiten, alle HTTP 200.

### Nicht in der Sitemap, aber verlinkt

```
/mcp                 Verkaufsseite des gehosteten MCP, eigene Navigation
/updates             Changelog, v1.40 bis v3.4.0
/ai-info.html        Faktenseite für Sprachmodelle
```

### Hauptseiten

```
/                    Startseite, Erweiterung
/about               Werdegang, Erweiterung und MCP
/contact             Formular
/schema-validator    freies Werkzeug, auch im MCP enthalten
/documentation       Doku-Einstieg, fünf Cluster
/blog                acht Beiträge
/blog/authors        ein Autor
/blog/authors/amin-foroutan
/privacy-policy      bezieht sich ausschließlich auf die Erweiterung
/terms-of-service
```

### Blog

```
/blog/google-search-console-missing-data              Pillar, drei Schichten der Datenlücke
/blog/how-to-connect-google-search-console-api        fünf Verbindungswege im Vergleich
/blog/gsc-api-use-cases                               fünf Analysen, die den Volldatensatz brauchen
/blog/google-search-console-mcp                       Kategorie-Erklärung, eigenes Open-Source-Projekt
/blog/keyword-cannibalization-google-search-console   Schwellenwerte und Behebungswege
/blog/moving-averages-seo-spot-real-trends-gsc        Grundlagen
/blog/how-to-calculate-moving-average-seo-data        Sheets, Python, Produkt
/blog/moving-average-seo-client-reporting             Monatsvergleiche im Kundenreporting
```

### Dokumentation

```
/documentation/advanced-visualizer                    + 10 Unterseiten
  .../activate-advanced-visualization-chart
  .../annotate-gsc-performance-charts
  .../view-google-algorithm-updates
  .../compare-dates-difference-charts-gsc
  .../customize-chart-colors-gsc-visualizer
  .../trendlines-moving-averages-gsc
  .../moving-average-trendline-calculations-gsc       Formeln, SMA und OLS
  .../adjust-daily-weekly-monthly-timeframes-gsc
  .../change-gsc-chart-types
  .../fix-non-english-chart-errors
/documentation/subfolder-performance                   + 4 Unterseiten
  .../activate-subfolder-performance-analyzer
  .../analyze-subfolder-performance-table-view
  .../subfolder-analyzer-tree-mode-guide
  .../configure-subfolder-tree-view-settings
/documentation/gsc-api                                 + 2 Unterseiten
  .../connect-gsc-visualizer-to-api
  .../export-unlimited-gsc-data-api                    Dimensionen, Filter, Export
/documentation/url-inspection-tool                     + 2 Unterseiten
  .../visualize-indexed-html-code
  .../compare-live-vs-indexed-pages
/documentation/crawl-stats                             + 1 Unterseite
  .../analyze-gsc-crawl-stats-budget                   Health- und Effizienzformeln
```
