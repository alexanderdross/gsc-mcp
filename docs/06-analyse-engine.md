# 06 — Analyse-Engine

Alle hier beschriebenen Berechnungen laufen deterministisch in SQL und TypeScript. Das Sprachmodell formuliert die Frage und deutet das Ergebnis, aber es rechnet nicht. Der Grund ist nicht Misstrauen gegenüber dem Modell, sondern Nachvollziehbarkeit: Wer eine Zahl in ein Management-Meeting trägt, muss ihre Herleitung erklären können.

**Grundlagen.** Die Durchschnittsposition wird stets als `position_sum / impressions` berechnet, nie als Mittelwert von Mittelwerten. Die CTR ist immer `clicks / impressions` und wird nie gespeichert. Beides folgt aus dem Speicherformat in [03-datenmodell.md](03-datenmodell.md).

---

## 1. Change-Attribution

Die häufigste Frage überhaupt lautet: „Warum sind die Klicks gefallen?" Zwei Zahlen nebeneinanderzustellen beantwortet sie nicht.

### Zerlegung in Nachfrage und CTR

Wegen `clicks = impressions × ctr` lässt sich die Veränderung sauber aufteilen. Verwendet wird die **symmetrische Zerlegung**, die den Interaktionsterm hälftig auf beide Faktoren verteilt:

```
Δclicks = Δimpressions × (ctr_a + ctr_b)/2   ← Nachfrage-/Sichtbarkeitsanteil
        + Δctr         × (imp_a + imp_b)/2   ← CTR-Anteil
```

Diese Form ist exakt (die Summe ergibt immer `Δclicks`), symmetrisch gegenüber der Reihenfolge der Zeiträume und über Segmente additiv — man kann die Beiträge einzelner Queries aufsummieren und erhält den Gesamteffekt. Die naive Zerlegung mit einem separaten Restterm hat diese Eigenschaften nicht.

### Aufspaltung des CTR-Anteils

Der CTR-Anteil wird weiter zerlegt, denn eine gefallene CTR kann zwei sehr verschiedene Ursachen haben: schlechteres Ranking oder ein schlechteres Snippet.

Mit der site-eigenen CTR-Kurve `E(p)` (Abschnitt 3) und dem Residuum `r = ctr − E(p)`:

```
Δctr = [E(p_b) − E(p_a)]   ← Ranking-Effekt
     + [r_b − r_a]          ← Snippet-Effekt (Titel, Description, Rich Results)
```

Damit liefert `compare_periods` drei benannte Ursachen statt einer Zahl:

| Anteil | Bedeutung | Typische Ursache |
|---|---|---|
| Nachfrage | weniger Impressionen bei gleicher Position | saisonale Nachfrage, verlorene Keywords, SERP-Layout |
| Ranking | Position verschlechtert | Wettbewerb, Algorithmus-Update, technisches Problem |
| Snippet | CTR unter dem Positionserwartungswert | Titel/Description geändert, Rich Result verloren, AI Overview |

### Beitragsrechnung je Segment

Dieselbe Zerlegung wird je Query bzw. Seite berechnet und nach dem Betrag des Beitrags sortiert. Ausgegeben werden die größten Einzelposten plus ein Sammelposten für den Rest, sodass sich die Summe wieder zum Gesamteffekt fügt. Genau hier zahlt sich die Sammelzeile aus [03-datenmodell.md](03-datenmodell.md) aus: Ohne sie wäre die Attribution systematisch unvollständig.

---

## 2. Anomalie-Erkennung

Ziel ist, echte Ereignisse von Wochenendmustern, Feiertagen und Zufallsschwankungen zu trennen.

### Schritt 1 — Wochentagsmuster herausrechnen

Über die letzten acht Wochen:

```
trend_t   = gleitender 7-Tage-Median (zentriert)
ratio_t   = y_t / trend_t
f_w       = Median aller ratio_t mit Wochentag w,  normiert auf Mittelwert 1
y*_t      = y_t / f_w                              ← saisonbereinigte Reihe
```

Der Median statt des Mittelwerts ist Absicht: Ein einzelner Ausreißer soll das Wochentagsprofil nicht verbiegen.

### Schritt 2 — robuste Baseline

Über die 28 Tage vor dem geprüften Punkt (dieser selbst ausgeschlossen):

```
baseline = Median(y*)
scale    = 1,4826 × MAD(y*)          ← MAD = Median der absoluten Abweichungen
z_t      = (y*_t − baseline) / scale
```

Der Faktor 1,4826 skaliert die MAD auf die Standardabweichung einer Normalverteilung. Gegenüber Mittelwert und Standardabweichung ist dieses Paar unempfindlich gegen genau die Ausreißer, die gefunden werden sollen — ein einzelner starker Einbruch würde eine klassische Standardabweichung so weit aufblähen, dass er sich selbst unauffällig macht.

### Schritt 3 — kleine Zahlen gesondert behandeln

Bei einer Baseline unter etwa 30 Klicks pro Tag ist die Normalverteilungsannahme unbrauchbar; Klicks sind Zähldaten. Dort wird stattdessen ein exakter Poisson-Test gegen die Baseline gerechnet und über das p-Niveau entschieden. Ohne diese Fallunterscheidung produzieren kleine Seiten laufend Fehlalarme — der häufigste Grund, warum Anomalie-Features ungenutzt bleiben.

### Schritt 4 — Schwelle und Mindesteffekt

| Empfindlichkeit | Schwelle |z| | Mindestveränderung |
|---|---|---|
| `low` | 3,5 | ≥ 20 % und ≥ 50 Klicks |
| `medium` | 3,0 | ≥ 15 % und ≥ 20 Klicks |
| `high` | 2,5 | ≥ 10 % und ≥ 10 Klicks |

Beide Bedingungen müssen erfüllt sein. Statistische Signifikanz allein reicht nicht: Bei sehr stabilen Reihen ist eine Veränderung von drei Prozent signifikant und trotzdem bedeutungslos.

### Schritt 5 — Ausreißer von Niveauverschiebung unterscheiden

Ein CUSUM-Verfahren über die saisonbereinigte Reihe trennt zwei Fälle, die völlig unterschiedliche Reaktionen erfordern:

- **Ausreißer** — ein einzelner Tag weicht ab, danach Rückkehr zur Baseline. Meist Messartefakt oder Tagesereignis.
- **Niveauverschiebung** — der Mittelwert bleibt dauerhaft verschoben. Das ist der eigentlich interessante Fall; ausgegeben werden Beginn, Ausmaß und ob das Niveau anhält.

### Schritt 6 — Ursachenzuordnung

Für jede Auffälligkeit wird geprüft:

1. **Segmentbeitrag** — Change-Attribution zwischen dem Fenster davor und danach, um zu benennen, welche Queries, Seiten, Länder oder Geräte den Ausschlag gaben. Ein Einbruch, der ausschließlich auf Mobilgeräten oder in einem Land auftritt, hat eine völlig andere Ursache als ein flächiger.
2. **Google-Updates** — fällt ein bestätigtes Update in ein Fenster von ±3 Tagen, wird es benannt. Ausdrücklich als zeitliche Koinzidenz, nicht als bewiesene Ursache.
3. **Indexierung** — sind betroffene Seiten in `url_inspections` als nicht indexiert erfasst, wird darauf hingewiesen.

---

## 3. CTR-Kurve

Generische CTR-Tabellen aus Branchenstudien sind für die Bewertung einer einzelnen Website unbrauchbar — die tatsächliche CTR je Position variiert massiv nach Branche, Marke, Gerät und SERP-Aufbau. Die Kurve wird deshalb aus den eigenen Daten geschätzt.

**Verfahren**

1. Alle Query-Zeilen der letzten 90 Tage, gruppiert nach Position in Halbschritten (1,0 · 1,5 · 2,0 …)
2. Je Bucket die impressionsgewichtete CTR
3. **Isotone Regression** (Pool-Adjacent-Violators) erzwingt eine monoton fallende Kurve — lokale Umkehrungen aus dünnen Buckets werden geglättet, ohne die Kurve durch eine willkürliche Funktionsform zu verfälschen
4. Buckets mit weniger als 1.000 Impressionen werden mit dem Nachbarn zusammengelegt
5. Getrennte Kurven für Marken- und Nicht-Marken-Queries sowie je Gerät, sofern genügend Datenpunkte vorliegen

Der Marken-Split ist entscheidend: Markenanfragen erreichen auf Position 1 oft 60 bis 80 Prozent CTR, generische 20 bis 30. Eine gemeinsame Kurve macht jede Bewertung wertlos.

**Anwendung.** `E(p)` ist der Erwartungswert, `r = ctr − E(p)` das Residuum. `ctr_analysis` meldet Seiten mit `r < −0,5 × E(p)` bei mindestens 500 Impressionen — also solche, die weniger als die Hälfte der positionsüblichen CTR erreichen.

---

## 4. Striking Distance

```
Kandidat:      p̄ zwischen position_min und position_max (Vorgabe 5–20)
               und impressions ≥ Schwelle (Vorgabe 100)

Potenzial:     Δclicks = impressions × (E(p_ziel) − ctr_aktuell)
               p_ziel = 3,0 (konservativ, nicht 1,0)
```

Das Zielniveau ist bewusst zurückhaltend gewählt. Position 1 als Referenz erzeugt Potenzialzahlen, die niemand einlöst, und beschädigt das Vertrauen in alle weiteren Ausgaben.

Sortiert wird nach absolutem Klickpotenzial, nicht nach Position. Eine Query auf Position 12 mit 5.000 Impressionen ist wertvoller als eine auf Position 6 mit 80.

---

## 5. Kannibalisierung

Mehrere rankende URLs für dieselbe Suchanfrage sind nicht per se ein Problem. Schädlich ist die **Instabilität**: Wenn Google wöchentlich die Zielseite wechselt, verliert jede von ihnen Ranking-Signale.

Je Query im Zeitraum, über `fact_query_page`:

```
share_i    = impressions_i / Σ impressions        Anteil je URL
HHI        = Σ share_i²                            1 = eine URL, → 0 = stark verteilt
dispersion = 1 − HHI

switches   = Anzahl Wochen, in denen die impressionsstärkste URL
             von der Vorwoche abweicht
switch_rate = switches / (Wochen − 1)

score = 0,6 × switch_rate + 0,4 × dispersion
```

Gemeldet werden Queries mit mindestens zwei URLs über der Impressionsschwelle und `score ≥ 0,3`. Die Gewichtung betont bewusst den Wechsel: Zwei URLs mit stabiler Rangfolge sind meist harmlos, zwei abwechselnde fast immer ein Problem.

**Sortiert wird nach dem, was auf dem Spiel steht**, nicht nach dem Score:

```
clicks_at_stake = impressions_gesamt × (E(p_beste_URL) − ctr_gesamt)
```

Also die Differenz zwischen dem, was die stärkste URL allein erreichen würde, und dem, was die zersplitterte Situation tatsächlich liefert.

---

## 6. Content Decay

Ein Klickrückgang einer Seite ist nur dann ihr eigenes Problem, wenn er stärker ausfällt als der Rückgang der gesamten Website. Sonst misst man Saisonalität.

```
page_yoy = clicks(letzte 90 Tage) / clicks(gleiche 90 Tage im Vorjahr) − 1
site_yoy = analog für fact_totals
decay    = page_yoy − site_yoy          ← seitenspezifischer Anteil
```

Zusätzlich ein robuster Trend über die Monats-Rollups: **Theil-Sen-Steigung** (Median aller paarweisen Steigungen) über die letzten 12 bis 24 Monate. Robust gegen einzelne Ausreißermonate, die eine gewöhnliche Regression kippen würden.

Gemeldet werden Seiten mit `decay < −0,25` und negativer Theil-Sen-Steigung bei mindestens 100 Klicks im Vorjahreszeitraum.

**Dieses Tool ist auf einem Passthrough-Modell nicht abbildbar**, weil es Daten über die 16-Monats-Grenze hinaus voraussetzt — und ist damit die deutlichste Demonstration des Warehouse-Ansatzes.

---

## 7. Brand vs. Non-Brand

Zuordnung über `properties.brand_pattern` (Regex, bei Anlage aus dem Domainnamen vorgeschlagen, vom Nutzer korrigierbar) auf `dim_query.is_brand`.

Die Ausgabe hat **drei** Kategorien, nicht zwei: Marke, Nicht-Marke und *nicht zugeordnet*. Die dritte enthält die von Google anonymisierten Impressionen. Sie einer der beiden Seiten zuzuschlagen oder stillschweigend aus dem Nenner zu nehmen, verfälscht den Non-Brand-Anteil — meist um mehrere Prozentpunkte, und immer in dieselbe Richtung.

---

## Prüfbarkeit

Jede dieser Funktionen wird gegen einen festen Datensatz mit bekannten Ergebnissen getestet (`packages/analytics/fixtures`). Für die Attribution gilt zusätzlich eine Invariante, die als Eigenschaftstest über zufällige Eingaben läuft:

```
Σ (Beiträge aller Segmente) == Δclicks_gesamt     (bis auf Gleitkomma-Toleranz)
```

Bricht diese Identität, ist die Ausgabe nicht bloß ungenau, sondern irreführend — ein Beitrag, der sich nicht zum Ganzen summiert, führt jeden Leser in die Irre, der ihn für vollständig hält.
