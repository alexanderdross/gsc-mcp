# 07 — Monetarisierung und Abrechnung

## Was sich nach der Marktanalyse geändert hat

Die erste Fassung dieses Kapitels entstand, als Advanced GSC als einziger ernsthafter Wettbewerber galt. Die Analyse in [00-konzept.md](00-konzept.md) hat das korrigiert: Über zwanzig GSC-MCP-Projekte auf GitHub, kostenlose selbst hostbare Alternativen, eine gehostete Beta zum Nulltarif und ein gehosteter Wettbewerber ab 10 $. Daraus folgen drei Anpassungen:

**1 — Zeilenobergrenzen verschwinden als Preismerkmal.** Auf PostgreSQL kostet Speicher fast nichts ([03-datenmodell.md](03-datenmodell.md)). Die einzige verbleibende Grenze ist Googles eigene von rund 50.000 Zeilen pro Tag und Suchtyp. **Alle Pläne holen künftig, was Google hergibt.** Ein künstlicher Deckel wäre bei kostenloser Konkurrenz weder verkaufbar noch begründbar.

**2 — Der Schwerpunkt verschiebt sich zum Agenturgeschäft.** Gegen „kostenlos, aber selbst betreiben" gewinnt man Einzelnutzer nur über Bequemlichkeit, und Bequemlichkeit trägt keine hohen Preise. Mandantentrennung, White-Label, Team-Zugänge, AVV und ein Ansprechpartner sind dagegen Dinge, die kein Open-Source-Projekt liefert. Der Einstiegsplan dient der Gewinnung, das Agenturgeschäft dem Umsatz.

**3 — Alerts werden zum tragenden Merkmal, nicht zur Zugabe.** Proaktive Benachrichtigung bietet im gesamten Feld niemand an. Sie ist der Schritt vom Werkzeug zum Dienst — und der überzeugendste Grund, monatlich zu zahlen, statt einmal ein kostenloses Projekt einzurichten.

## Preislogik

Der Wettbewerber staffelt nach **zugekauften Datenquellen** (SERP, Keyword-Volumen, Backlinks) und muss deshalb Monatskontingente verkaufen — jede Abfrage kostet ihn Geld.

Unsere Kosten liegen in Speicher, Sync-Rechenzeit und der geteilten Google-Quote. Wir staffeln deshalb nach **Betriebstiefe**: Anzahl Properties, Sync-Frequenz, Auflösung des Query×Page-Grains, Analysetiefe und Betriebszusagen. Angenehmer Nebeneffekt: Der Kunde bezahlt für etwas, das mit der Zeit wertvoller wird, statt aufgebraucht zu sein.

## Plan-Matrix

| | **Free** | **Starter** €15 | **Pro** €45 | **Agency** €199 |
|---|---|---|---|---|
| Properties | 1 | 3 | 15 | unbegrenzt |
| Historie | 30 Tage | 16 Monate | **unbegrenzt** ab Sync-Start | unbegrenzt |
| Datenquelle | live (Passthrough) | Warehouse | Warehouse | Warehouse |
| Sync | – | täglich | stündlich | stündlich, priorisiert |
| Zeilentiefe im Warehouse | – | **voll** | **voll** | **voll** |
| Query×Page-Grain | – | Woche | Tag | Tag |
| Zeilen je Antwort | 100 | 1.000 | 5.000 | 5.000 |
| URL-Inspektion | 10/Tag | 200/Tag | 2.000/Tag | 2.000/Tag je Property |
| Analyse-Engine | – | Basis¹ | vollständig | vollständig |
| Stundendaten | – | – | ✓ | ✓ |
| Export (CSV/Parquet) | – | ✓ | ✓ | ✓ |
| **Alerts & geplante Reports** | – | – | **✓** | **✓** |
| Team-Zugänge | – | – | 2 | 10 |
| White-Label-Reports | – | – | – | ✓ |
| AVV (Art. 28 DSGVO) | – | auf Anfrage | ✓ | ✓ |
| Direkter EU-Zugang ohne Proxy | – | – | ✓ | ✓ |
| Support | Community | E-Mail | E-Mail, priorisiert | benannter Ansprechpartner, Onboarding |

¹ *Basis* = `top_movers`, `striking_distance`, `brand_vs_nonbrand`. *Vollständig* ergänzt `detect_anomalies`, `compare_periods` mit Attribution, `find_cannibalization`, `ctr_analysis`, `content_decay`.

**Jahreszahlung** mit zwei Freimonaten (rund 17 % Rabatt) — etwas großzügiger als die 15 % des Wettbewerbers auf Quartalsbasis, weil Jahresbindung die Backfill-Kosten amortisiert.

**Positionierung:** Starter liegt bewusst bei 15 € statt 19 €, weil er gegen kostenlose Selbstbetriebs-Alternativen bestehen muss und nur über Bequemlichkeit gewinnt. Pro bei 45 € ist der Arbeitsplan, in dem Alerts und volle Analyse liegen. Agency bei 199 € ist höher angesetzt als zuvor, weil dort die Merkmale liegen, die im Feld sonst niemand anbietet — und weil dieses Segment nicht auf zehn Euro schaut, sondern auf Verlässlichkeit und Rechtssicherheit.

**Der direkte EU-Zugang ohne Cloudflare-Proxy** ist ab Pro ein ausgewiesenes Merkmal ([08-security-dsgvo.md](08-security-dsgvo.md)). Er kostet uns fast nichts und ist für Kunden mit strenger Beschaffung ein Ausschlusskriterium — genau die Art von Merkmal, die ein Abo rechtfertigt, ohne den Betrieb zu verteuern.

## Warum der Free-Plan kein Warehouse bekommt

Ein Backfill kostet 1.500 bis 3.500 API-Calls gegen die **geteilte** Google-Projektquote und belegt dauerhaft Speicher. Bei kostenlosen Nutzern wäre das der größte Einzelposten der Betriebskosten — und würde die Quote zahlender Kunden schmälern.

Der Free-Plan läuft deshalb als reiner Passthrough. Das ist kein künstlicher Riegel, sondern spiegelt die Kostenstruktur und macht das Upgrade-Argument konkret: Genau die Grenze, an die der Nutzer stößt, hebt der bezahlte Plan auf.

## Stripe-Umsetzung

**Objekte**

| Stripe | Ausprägung |
|---|---|
| Product | drei: Starter, Pro, Agency (Free hat kein Produkt) |
| Price | je Produkt zwei: monatlich, jährlich (EUR) |
| Customer | 1:1 zu `core.users`, `stripe_customer_id` in PostgreSQL |
| Subscription | 1:1 zu `core.subscriptions` |
| Checkout Session | Neuabschluss und Planwechsel |
| Billing Portal | Kündigung, Zahlungsmittel, Rechnungen — keine Eigenentwicklung |

Das Billing Portal ist eine bewusste Entscheidung: Kündigung, Rechnungsabruf und Zahlungsmittelwechsel selbst zu bauen kostet Wochen und schafft rechtliche Angriffsfläche, während Stripes Variante fertig und geprüft ist.

**Webhooks** unter `https://gsc2mcp.drossmedia.de/webhooks/stripe`:

| Event | Wirkung |
|---|---|
| `checkout.session.completed` | Abo anlegen, Plan setzen, Backfill anstoßen |
| `customer.subscription.updated` | Plan, Status, Periodenende spiegeln; bei Downgrade Grains anpassen |
| `customer.subscription.deleted` | auf `free` zurückstufen, Sync deaktivieren, Daten aufbewahren |
| `invoice.payment_failed` | Kulanzfrist starten, Nutzer benachrichtigen |
| `invoice.paid` | Kulanzfrist beenden |

**Signaturprüfung** über die Stripe-Bibliothek. **Idempotenz** über `core.processed_events`: Stripe stellt Events mehrfach zu, und ein doppelt verarbeitetes `checkout.session.completed` würde einen zweiten Backfill auslösen — 3.500 API-Calls gegen die geteilte Quote, für nichts.

## Entitlements

Aufgelöst im Tool-Router, vor jedem Handler:

```
Request → user_id aus Token
        → Plan aus prozesslokalem Cache (60 s)  |  Fallback PostgreSQL
        → Entitlement: { properties_max, history_days, row_limit,
                          tools: Set<string>, inspect_per_day, ... }
        → Tool erlaubt?      nein → strukturierter Upgrade-Hinweis
        → Quote verfügbar?   nein → Hinweis mit Reset-Zeitpunkt
        → Handler, Parameter auf Planlimits gedeckelt
```

Der kurze Cache ist Absicht: Nach einem Upgrade soll die neue Stufe binnen einer Minute wirken, ohne dass jeder Tool-Call eine Datenbankabfrage kostet. Webhooks leeren den Cache zusätzlich sofort.

**Deckeln statt abweisen.** Fordert ein Free-Nutzer 5.000 Zeilen an, liefert das Tool 100 Zeilen plus Hinweis — keine Fehlermeldung. Eine abgewiesene Anfrage ist verlorener Nutzen; eine gekürzte mit sichtbarer Grenze ist ein Verkaufsargument.

## Herabstufung und Datenaufbewahrung

Ein gekündigtes Abo löscht keine Daten. Das Warehouse bleibt **90 Tage** erhalten:

- Der Nutzer kehrt auf `free` zurück und arbeitet im Passthrough-Modus
- Der Sync stoppt, das Archiv veraltet
- Bei Rückkehr innerhalb von 90 Tagen wird nur die Lücke nachsynchronisiert statt eines vollständigen Backfills
- Nach 90 Tagen wird das Warehouse gelöscht, nach vorheriger Ankündigung per E-Mail

Kundenfreundlich und betriebswirtschaftlich richtig zugleich: Die Rückkehrhürde sinkt drastisch, und die Lücke nachzuholen kostet einen Bruchteil eines Backfills.

## Trial

14 Tage Pro ohne Kreditkarte. Der Backfill startet sofort — die Historie ist das Produkt, und wer sie erst nach der Zahlung sieht, kann den Wert nicht beurteilen.

Nach Ablauf ohne Abschluss: Rückstufung auf Free, Daten bleiben nach der 90-Tage-Regel. Die Erinnerungen an Tag 10 und 13 nennen konkret, was im Archiv liegt („Ihre Daten reichen jetzt bis Mai 2025 zurück — ohne Pro endet der Zugriff bei 30 Tagen").

## Nutzungsbasierte Erweiterungen (ab Phase 6)

Als metered Prices additiv zum Grundabo: zusätzliche Properties über dem Planlimit, Inspektions-Kontingent über 2.000 pro Tag, zusätzliche Team-Zugänge. Bewusst erst nach Etablierung der Grundpläne — vermischte Preismodelle sind früh ein Konversionshemmnis.

## Kennzahlen

Aus `core.usage_events` und `core.audit_log`, ohne zusätzliches Tracking-Werkzeug:

| Kennzahl | Zweck |
|---|---|
| Tools je Sitzung, Verteilung der Toolnutzung | erkennen, was tatsächlich gebraucht wird |
| Free-Limit-Treffer je Nutzer und Woche | Vorhersage der Upgrade-Bereitschaft |
| Zeit von Verbindung bis erstem Tool-Call | Onboarding-Qualität |
| Backfill-Dauer je Property | Betriebskosten und Erwartungsmanagement |
| Anteil Nutzer mit aktiven Alerts | prüft die These aus Anpassung 3 |
| Trial-Konversion, Abwanderung je Plan | die üblichen Verdächtigen |

Die vorletzte ist nach der Marktanalyse die wichtigste: Wenn Alerts das tragende Differenzierungsmerkmal sind, muss sich das in der Nutzung zeigen. Tun sie es nicht, stimmt die Positionierung nicht — und das wäre besser früh zu wissen als nach dem Livegang.
