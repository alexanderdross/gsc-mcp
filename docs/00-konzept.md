# 00 — Konzept

## Ausgangslage

Die Google Search Console ist für jede Website die verlässlichste Datenquelle zur organischen Sichtbarkeit — und gleichzeitig eines der unhandlichsten Werkzeuge. Die Weboberfläche erlaubt nur flache Filter, keine Kohorten, keine Attribution, keine Historie über 16 Monate. Die API liefert mehr, verlangt aber Programmierarbeit für jede einzelne Frage.

Ein MCP-Server schließt diese Lücke: Der Nutzer fragt in natürlicher Sprache, der Agent wählt Dimensionen, Filter und Zeiträume und liefert eine Interpretation. Diese Kategorie existiert bereits — das Referenzprodukt ist **Advanced GSC**.

## Marktumfeld: Advanced GSC

Die Tool-Registry des Wettbewerbers wurde über dessen eigenen `get_capabilities`-Endpunkt live abgefragt (Stand August 2026):

**Auf dem Free-Plan verfügbar (10 Tools)**

| Gruppe | Tools |
|---|---|
| Immer verfügbar | `get_capabilities`, `get_started`, `select_property`, `show_pricing` |
| Search Console | `list_properties`, `get_search_analytics`, `inspect_url_enhanced`, `explore_performance` |
| Core Web Vitals | `check_core_web_vitals` |
| Utilities | `get_google_updates` |

**Hinter Bezahlschranken (48 weitere Tools)**

| Gruppe | Anzahl | Ab Plan |
|---|---|---|
| Search Console (erweitert, inkl. Sitemaps) | 7 | Starter |
| SERP Intelligence (Live-SERPs, AI Overviews, People-Also-Ask, Share of Voice) | 4 | Starter |
| Keyword Research (Volumen, Ideen, Difficulty) | 3 | Starter |
| Core Web Vitals (Trends, Wettbewerbsvergleich) | 1 | Starter |
| Google Analytics 4 | 11 | Pro |
| Technical SEO / Crawl | 14 | Agency |
| Backlinks | 9 | Agency |

**Preise:** Free · $15 · $40 · $105 pro Monat (Quartalszahlung 15 % günstiger). Kontingente statt Flatrates bei allen zugekauften Datenquellen: SERP-Abfragen 100/300/1.000 pro Monat, Keyword-Research identisch, Core Web Vitals 3/Tag im Free-Plan.

**Free-Tier-Beschränkungen**, wie der Server sie selbst kommuniziert: 30 Tage Historie, 100 Zeilen pro Abfrage, 10 URL-Inspektionen pro Tag. Bei Limitüberschreitung liefert er einen `[Free plan]`-Footer bzw. eine `[RATE_LIMITED]`-Meldung mit Upgrade-Link und weist den Agenten an, diese wörtlich weiterzugeben — ein wirksames, unaufdringliches Upselling-Muster, das wir übernehmen.

### Bewertung

Die Breite ist beachtlich, aber die Tiefe begrenzt. Das Produkt ist ein **Live-Passthrough**: Jeder Tool-Call geht direkt an die jeweilige API, es wird nichts persistiert. Daraus folgen drei strukturelle Schwächen, die kein Feature-Zukauf behebt:

1. **Es erbt sämtliche Google-Limits.** 16 Monate Historie, 25.000 Zeilen pro Request, ~50.000 Zeilen pro Tag und Suchtyp. Ein Jahresvergleich über zwei Jahre ist prinzipiell unmöglich.
2. **Es ist zustandslos.** Ohne gespeicherte Historie gibt es keine Baseline — also keine Anomalie-Erkennung, keine Alerts, keine geplanten Reports. Das Produkt kann nur antworten, nie hinweisen.
3. **Die Breite ist eingekauft.** SERP-Daten, Backlinks und Keyword-Volumen sind Drittanbieter-APIs mit Kosten pro Abfrage. Das erklärt die Kontingent-Modelle — und bedeutet, dass die Margen dieser Features strukturell dünn sind.

## Unsere Positionierung

**Nicht breiter, sondern tiefer.** Wir holen aus GSC-Daten mehr heraus als Google selbst zeigt, statt möglichst viele fremde Datenquellen anzuflanschen.

Der Hebel ist ein eigenes Data Warehouse. Was beim Passthrough eine harte Grenze ist, wird bei uns zum Feature:

| Google-Limit | Effekt beim Passthrough | Unser Hybrid-Ansatz |
|---|---|---|
| 16 Monate Historie, danach unwiederbringlich gelöscht | Jahresvergleiche über 16 Monate unmöglich | Eigenes Archiv wächst ab Sync-Start unbegrenzt weiter |
| 25.000 Zeilen pro Request | Antworten kappen den Longtail | Paginierter Sync holt vollständig ein |
| ~50.000 Zeilen pro Tag und Suchtyp | Longtail wird nie sichtbar | Täglich abgeholt, dauerhaft gespeichert |
| Query×Page-Paare nur ad hoc abfragbar | Kannibalisierung kaum analysierbar | Paar-Fakten persistiert → echte Zeitreihen |
| Kein Zustand, keine Baseline | Nur Frage-Antwort | Anomalie-Erkennung, Alerts, geplante Reports |

### Die fünf Differenzierer

**1 — Historie jenseits der 16 Monate.** Der einzige Weg zu echten Mehrjahresvergleichen. Für saisonale Geschäfte (Reise, Handel, B2B-Zyklen) ist das kein Komfort, sondern die Voraussetzung überhaupt sinnvoller Analyse. Dieser Vorsprung wächst mit jedem Betriebstag und ist von einem Passthrough-Wettbewerber nicht rückwirkend aufholbar.

**2 — Volle Auflösung statt Sampling.** Longtail-Queries bleiben dauerhaft auswertbar, weil sie einmal abgeholt und behalten werden.

Wie groß dieser Effekt ist, zeigt die Messung an einer eigenen Property. Für `sc-domain:aip.aero` über 28 Tage (28.982 Klicks, 767.142 Impressionen) entfallen auf die 100 klickstärksten Suchanfragen zusammen **8,3 % der Klicks** — die stärkste einzelne trägt 0,4 % bei. Rund 92 % des Geschehens liegen außerhalb dessen, was ein Werkzeug mit 100-Zeilen-Deckel überhaupt zeigt. Details in [03-datenmodell.md](03-datenmodell.md).

**3 — Deterministische Analyse-Engine.** Change-Attribution, Anomalie-Scores, CTR-Kurven und Kannibalisierungs-Heuristiken laufen als SQL und TypeScript, nicht als LLM-Schätzung. Der Agent formuliert die Frage und interpretiert das Ergebnis; die Zahlen selbst sind reproduzierbar und nachrechenbar. Das ist auch ein Vertrauensargument: Ein SEO-Verantwortlicher, der eine Zahl in ein Management-Meeting trägt, muss ihre Herleitung erklären können.

**4 — Proaktiv statt reaktiv.** Weil eine Baseline existiert, kann das System melden statt nur antworten: Traffic-Einbrüche, Indexierungsverluste, Ranking-Abstürze wichtiger Seiten — per E-Mail oder als wartende Nachricht in der nächsten Claude-Sitzung.

**5 — EU-Hosting und DSGVO.** Datenhaltung in der EU, AVV auf Anfrage, deutschsprachiger Support. Der Wettbewerber ist US-basiert; für Agenturen mit deutschen Mittelstands- oder Behördenkunden ist das häufig ein K.-o.-Kriterium in der Beschaffung.

### Bewusste Auslassungen im MVP

Kein SERP-Scraping, keine Backlinks, kein Keyword-Volumen. Diese Daten sind eingekauft, verursachen laufende Kosten pro Abfrage und zwingen zu Kontingent-Modellen, die Nutzer als Gängelung erleben. Sie sind später als optionale Add-ons denkbar — aber sie sind nicht der Grund, warum jemand dieses Produkt wählen sollte.

Kein GA4 im MVP. Die Kombination aus GSC und GA4 ist wertvoll und für Phase 6 vorgesehen, verdoppelt aber den OAuth-Scope, das Datenmodell und die Sync-Komplexität. Erst muss GSC exzellent sein.

## Zielgruppen

**Stufe 1 — Eigenbedarf.** Eigene Projekte, aktuell u. a. `sc-domain:aip.aero`. Diese Stufe muss ab Phase 1 echten Nutzen liefern, denn sie ist zugleich der Dauertest des Produkts.

**Stufe 2 — In-House-SEOs und Solo-Betreiber.** Ein bis fünf Properties, wollen Antworten statt Dashboards, haben keine Zeit für Looker Studio. Einstiegspunkt Starter/Pro.

**Stufe 3 — Agenturen.** Zehn bis hundert Kundenproperties, brauchen Mandantentrennung, White-Label-Reports und Team-Zugänge. Höchster Umsatz pro Kunde, aber auch höchste Anforderungen an Zuverlässigkeit und Rechtssicherheit. Agency-Plan.

## Erfolgskriterien

**Phase 1 (Eigenbedarf) ist erreicht, wenn** eine Frage wie „Warum sind die Klicks auf /flugzeuge im Juli eingebrochen?" in einer Claude-Sitzung beantwortbar ist, inklusive der Queries und Seiten, die den Rückgang erklären — ohne dass jemand die Search-Console-Oberfläche öffnet.

**Phase 5 (Kommerz) ist erreicht, wenn** ein fremder Nutzer sich ohne Rückfrage verbinden, seine Property auswählen, den Backfill abwarten und ein kostenpflichtiges Abo abschließen kann — und wenn die Google-OAuth-Verifizierung erteilt ist.
