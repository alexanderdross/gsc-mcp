# 07 — Monetarisierung und Abrechnung

## Preislogik

Der Wettbewerber staffelt nach **Zugriff auf zugekaufte Datenquellen** (SERP-Abfragen, Keyword-Volumen, Backlinks) und muss deshalb mit Monatskontingenten arbeiten — jede Abfrage kostet ihn Geld.

Unsere Kosten liegen woanders: in Speicher und Sync-Rechenzeit. Also staffeln wir nach **Datentiefe**: Anzahl Properties, Länge der Historie, Auflösung des Warehouse und Sync-Frequenz. Das hat einen angenehmen Nebeneffekt — die Preisstufen korrelieren direkt mit den tatsächlichen Betriebskosten, und der Kunde bezahlt für etwas, das mit der Zeit wertvoller wird statt aufgebraucht zu sein.

## Plan-Matrix

| | **Free** | **Starter** €19 | **Pro** €49 | **Agency** €149 |
|---|---|---|---|---|
| Properties | 1 | 3 | 10 | unbegrenzt |
| Historie | 30 Tage | 16 Monate | **unbegrenzt** ab Sync-Start | unbegrenzt |
| Datenquelle | live (Passthrough) | Warehouse | Warehouse | Warehouse |
| Sync | – | täglich | stündlich | stündlich, priorisiert |
| Zeilen je Tag und Dimension | – | 5.000 | 25.000 | 50.000 |
| Query×Page-Grain | – | Woche | Tag | Tag |
| Zeilen je Antwort | 100 | 500 | 2.000 | 5.000 |
| URL-Inspektion | 10/Tag | 100/Tag | 2.000/Tag | 2.000/Tag je Property |
| Analyse-Engine | – | Basis¹ | vollständig | vollständig |
| Stundendaten | – | – | ✓ | ✓ |
| Export (CSV/Parquet) | – | – | ✓ | ✓ |
| Alerts & geplante Reports | – | – | ✓ | ✓ |
| MCP Apps | ✓ | ✓ | ✓ | ✓ |
| Team-Zugänge | – | – | – | 5 inklusive |
| White-Label-Reports | – | – | – | ✓ |
| Support | Community | E-Mail | E-Mail, priorisiert | E-Mail + Onboarding |

¹ *Basis* = `top_movers`, `striking_distance`, `brand_vs_nonbrand`. *Vollständig* ergänzt `detect_anomalies`, `compare_periods` mit Attribution, `find_cannibalization`, `ctr_analysis`, `content_decay`.

**Jahreszahlung** mit zwei Freimonaten (rund 17 % Rabatt) — etwas großzügiger als die 15 % des Wettbewerbers auf Quartalsbasis, weil Jahresbindung unsere Backfill-Kosten amortisiert.

**Positionierung zum Wettbewerber:** Starter liegt bei €19 gegenüber $15, Pro bei €49 gegenüber $40. Wir sind bewusst nicht billiger. Der Free-Plan ist funktional dem des Wettbewerbers vergleichbar (30 Tage, 100 Zeilen, 10 Inspektionen pro Tag) und dient demselben Zweck: Er soll den Nutzen zeigen und die Grenze spürbar machen.

## Warum der Free-Plan kein Warehouse bekommt

Ein Backfill kostet 1.500 bis 3.500 API-Calls und belegt dauerhaft Speicher. Bei kostenlosen Nutzern wäre das der größte Einzelposten der Betriebskosten — und würde zugleich die geteilte Google-Projektquote für zahlende Kunden schmälern.

Der Free-Plan läuft deshalb als reiner Passthrough. Das ist kein künstlicher Riegel, sondern spiegelt die Kostenstruktur und macht das Upgrade-Argument konkret: Genau die Grenze, an die der Nutzer stößt, ist die, die der bezahlte Plan aufhebt.

## Stripe-Umsetzung

**Objekte**

| Stripe | Ausprägung |
|---|---|
| Product | vier: Starter, Pro, Agency (Free hat kein Produkt) |
| Price | je Produkt zwei: monatlich, jährlich (EUR) |
| Customer | 1:1 zu `users`, `stripe_customer_id` in D1 |
| Subscription | 1:1 zu `subscriptions` |
| Checkout Session | für Neuabschluss und Planwechsel |
| Billing Portal | Kündigung, Zahlungsmittel, Rechnungen — keine Eigenentwicklung |

Das Billing Portal ist eine bewusste Entscheidung: Kündigung, Rechnungsabruf und Zahlungsmittelwechsel selbst zu bauen, kostet Wochen und schafft rechtliche Angriffsfläche, während Stripes Variante fertig und geprüft ist.

**Webhooks** unter `/webhooks/stripe` im `web`-Worker:

| Event | Wirkung |
|---|---|
| `checkout.session.completed` | Abo anlegen, Plan setzen, Backfill anstoßen |
| `customer.subscription.updated` | Plan, Status, Periodenende spiegeln; bei Downgrade Grains anpassen |
| `customer.subscription.deleted` | auf `free` zurückstufen, Sync deaktivieren, Daten aufbewahren (siehe unten) |
| `invoice.payment_failed` | Kulanzfrist starten, Nutzer benachrichtigen |
| `invoice.paid` | Kulanzfrist beenden |

**Signaturprüfung** über die Stripe-Signatur mit WebCrypto (HMAC-SHA256) — die Stripe-Node-Bibliothek setzt Node-Crypto voraus und ist in Workers nicht ohne Weiteres nutzbar. **Idempotenz** über die Event-ID in einer `processed_events`-Tabelle: Stripe stellt Events mehrfach zu, und ein doppelt verarbeitetes `checkout.session.completed` würde einen zweiten Backfill auslösen.

## Entitlements

Aufgelöst im Tool-Router, vor jedem Handler:

```
Request → user_id aus Token
        → Plan aus KV (Cache, 60 s)  |  Fallback D1
        → Entitlement-Objekt: { properties_max, history_days, row_limit,
                                 tools: Set<string>, inspect_per_day, ... }
        → Tool erlaubt?      nein → strukturierter Upgrade-Hinweis
        → Quote verfügbar?   nein → Hinweis mit Reset-Zeitpunkt
        → Handler, Parameter auf Planlimits gedeckelt
```

Der kurze Cache ist Absicht: Nach einem Upgrade soll die neue Stufe innerhalb einer Minute wirken, ohne dass jeder Tool-Call eine Datenbankabfrage kostet. Webhooks invalidieren den Cache zusätzlich sofort.

**Deckeln statt abweisen.** Fordert ein Free-Nutzer 5.000 Zeilen an, liefert das Tool 100 Zeilen plus Hinweis — keine Fehlermeldung. Eine abgewiesene Anfrage ist verlorener Nutzen; eine gekürzte mit sichtbarer Grenze ist ein Verkaufsargument.

## Herabstufung und Datenaufbewahrung

Ein gekündigtes Abo löscht keine Daten. Das Warehouse bleibt **90 Tage** erhalten:

- Der Nutzer kehrt auf `free` zurück und arbeitet im Passthrough-Modus
- Der Sync stoppt, das Archiv veraltet
- Bei Rückkehr innerhalb von 90 Tagen wird nur die Lücke nachsynchronisiert statt eines vollständigen Backfills
- Nach 90 Tagen wird das Warehouse gelöscht, nach vorheriger Ankündigung per E-Mail

Das ist zugleich kundenfreundlich und betriebswirtschaftlich richtig: Die Rückkehrhürde sinkt drastisch, und die 90-Tage-Lücke nachzuholen kostet einen Bruchteil eines Backfills.

## Trial

14 Tage Pro ohne Kreditkarte. Der Backfill startet sofort — die Historie ist das Produkt, und wer sie erst nach der Zahlung sieht, kann den Wert nicht beurteilen.

Nach Ablauf ohne Abschluss: Rückstufung auf Free, Daten bleiben nach der 90-Tage-Regel erhalten. Die Erinnerungen (Tag 10 und Tag 13) nennen konkret, was im Archiv liegt („Ihre Daten reichen jetzt bis Mai 2025 zurück — ohne Pro endet der Zugriff bei 30 Tagen").

## Nutzungsbasierte Erweiterungen (ab Phase 6)

Als metered Prices, additiv zum Grundabo: zusätzliche Properties über dem Planlimit, Inspektions-Kontingent über 2.000 pro Tag, Aufbewahrung über die Standardhistorie hinaus. Bewusst erst nach der Etablierung der Grundpläne — vermischte Preismodelle sind früh im Produktleben ein Konversionshemmnis.

## Kennzahlen

Aus `usage_events` und `audit_log` ohne zusätzliches Tracking-Werkzeug:

| Kennzahl | Zweck |
|---|---|
| Tools je Sitzung, Verteilung der Toolnutzung | erkennen, was tatsächlich gebraucht wird |
| Free-Limit-Treffer je Nutzer und Woche | Vorhersage der Upgrade-Bereitschaft |
| Zeit von Verbindung bis erstem Tool-Call | Onboarding-Qualität |
| Backfill-Dauer je Property | Betriebskosten und Erwartungsmanagement |
| Trial-Konversion, Abwanderung je Plan | die üblichen Verdächtigen |

Die interessanteste dürfte die zweite sein: Wie oft jemand an eine Grenze stößt, bevor er zahlt, ist die direkteste Messgröße dafür, ob der Free-Plan richtig geschnitten ist.
