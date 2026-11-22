# Personalakte: Konzept

Stand: 22.11.2026 · Auftraggeber: Mansur Khaydayev · Projekt: Staff-Solutions

## 1. Worum es geht und warum

Heute liegt jede Personalakte als Ordner in der Dropbox (`01_Anmeldung`, `03_Formulare`,
`04_Vereinbarungen` …). Ordner entstehen nur, wenn es Unterlagen gibt, und man muss sie einzeln
durchklicken. Ob Onboarding-Unterlagen fehlen, sieht niemand auf einen Blick; das wurde zuletzt
vernachlässigt und soll jetzt bei allen Mitarbeitern nachgeholt werden.

Die Personalakte ersetzt diese Ordner. Ein Klick auf einen Namen in der Mitarbeiterliste öffnet
alles zu dieser Person an einem Ort. Benutzt wird sie, um **Informationen nachzusehen** und um
**Daten abzulegen**.

**Leitgedanke des Auftraggebers: Alles muss nachweisbar sein.** Die Firma sichert sich auf allen
Ebenen ab, weil schon versucht wurde, Regeln zu umgehen. Jede Änderung der Arbeitszeit ist eine
eigene, unterschriebene Vereinbarung – auch das Zurückgehen nach dem Sommer.

## 2. Ziele

1. Akte als eigene Seite je Dienstverhältnis, aufrufbar aus der Mitarbeiterliste.
2. **Übersicht (Seite 1):** Stammdaten, GmbH, Arbeitsort, aktuelle Soll-Stunden, Stand der
   Onboarding-Unterlagen („5 von 8, fehlt: …“), Hinweise. Resturlaub als Platzhalter.
3. **Stunden (Seite 2):** nur als vorbereiteter Platzhalter (siehe Nicht-Ziele).
4. **Anstellungsverlauf:** Stundenanpassungen mit „gültig ab“ eintragen, auch im Voraus.
   Brutto wird aus der Brutto-Tabelle ermittelt. Jede Anpassung verlangt eine Vereinbarung;
   solange deren unterschriebener Scan fehlt, steht deutlich **„Nachweis fehlt“**.
5. **Dokumente:** Unterlagen hochladen (eingescannt), nach Kategorien geordnet, ansehen und
   herunterladen. Eine hochgeladene Onboarding-Unterlage hakt den Punkt in der Checkliste ab.
6. **Onboarding-Liste in den Einstellungen pflegbar** (Name, Reihenfolge, Pflicht oder freiwillig).
7. **Liste „Wem fehlt was“** über alle Mitarbeiter: fehlende Onboarding-Unterlagen, fehlende
   Nachweise für Stundenanpassungen, nachzureichende Versicherungsnummern.
8. **Änderungen an Stammdaten mit Nachweis:** Jede Änderung an Personen- oder
   Lohnverrechnungsdaten (Name, Anrede, Adresse, Kontakt, IBAN, BIC, Versicherungsnummer,
   Staatsangehörigkeit) wird ein Änderungseintrag mit altem und neuem Wert, gültig ab, Grund
   und Nachweis-Dokument. Der vorherige Stand bleibt immer erhalten (siehe §9a).
9. **Änderungsprotokoll** der Person (nur Büro).

## 3. Nicht-Ziele (kommen später, eigene Projekte)

- **Stunden, Urlaub, Krankenstand** (Seite 2 mit Inhalt): eigenes Projekt. Offen sind noch die
  Datenquelle der Stunden und vier rechtliche Fragen an die Lohnverrechner.
- **Unterschriftsmappe am iPad** (Dienstzettel und Onboarding-Unterlagen nacheinander auf dem
  Bildschirm unterschreiben, jede Seite einzeln gespeichert): eigenes Projekt direkt danach.
  Die Akte bereitet es vor (Onboarding-Liste, Dokument je Unterlage, Unterschriften je Dokument).
- **Dokumente automatisch erzeugen** (Vereinbarung aus Vorlage befüllen): kommt mit der Mappe.
- **Studiowechsel** (selten; bedeutet Wechsel der GmbH mit Ummeldung).
- **Austritt** mit Checkliste (z. B. Rückgabe der Arbeitskleidung).
- **Benutzerverwaltung** in der App.
- Neugestaltung des Designs (erst wenn die Funktionen stehen).

## 4. Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Eine Stundenanpassung gilt, ohne dass sichtbar ist, dass der Nachweis fehlt.
- Jemand sieht in der Akte mehr, als seine Rolle laut `rollen_recht` sehen darf.
- Ein Dokument oder eine Anpassung kann spurlos gelöscht oder überschrieben werden.
- Prüfregeln lassen sich durch die App umgehen (die Datenbank muss sie selbst prüfen).
- Eine Änderung an Stammdaten überschreibt den alten Wert spurlos.

## 5. Rahmenbedingungen

- Technik wie bisher: Web-App ohne Bibliotheken (reines HTML/CSS/JavaScript, `app/`),
  Supabase (Datenbank, Anmeldung, Dateiablage), Veröffentlichung über Netlify. In der
  Entwicklungsumgebung lassen sich keine npm-Pakete installieren.
- Sicherheit liegt in der Datenbank (Zugriffsregeln, Prüffunktionen), nicht in der App.
- Rechte nach `rollen_recht` (Datenstufen Kontakt, Personendaten, Entgelt, Lohnverrechnung,
  Dokumente; Reichweite alle / zugeordnete / eigene). Schreiben dürfen Admin, Geschäftsführung,
  Personalbüro (`app.ist_buero()`), sofern unten nichts anderes steht.
- Nur erfundene Daten (Demo-Firma), bis die Rechtefrage mit dem Arbeitgeber geklärt ist.
- Bedienung auch am iPad (Fingerbedienung). Oberfläche auf Deutsch, österreichische Formate.
- Netlify-Sicherheitsregel (CSP) erlaubt nur Verbindungen zur eigenen Supabase-Adresse; die
  Dateiablage liegt unter derselben Adresse.

## 6. Wege, die erwogen wurden

| Weg | Beschreibung | Bewertung |
|---|---|---|
| **A – eigener Verlauf (gewählt)** | Jede Stundenanpassung ist ein eigener Eintrag mit „gültig ab“ (Stunden, Tage, Beschäftigungsart), dazu ein Entgelt-Eintrag mit demselben Datum und eine Vereinbarung als Dokument. | Jede Stufe belegt und datiert; Änderungen im Voraus möglich; die spätere Stundenauswertung kann je Kalenderwoche das richtige Soll rechnen. Etwas mehr Aufwand. |
| B – Werte überschreiben | Stunden im Dienstverhältnis ändern, Verlauf nur im Änderungsprotokoll. | Kein „gültig ab“, keine Änderungen im Voraus, Auswertung kann nicht sauber rechnen. Widerspricht dem Leitgedanken. |

Für die Darstellung: **eigene Seite** statt Seitenleiste über der Liste, weil Hochladen und
Formulare am iPad Platz brauchen.

## 7. Entscheidungen des Auftraggebers

- Weg A.
- Akte mit mehreren Seiten: Seite 1 Übersicht, Seite 2 Stunden (Inhalt später).
- Stundenanpassungen werden **eingetragen**, nicht aus Dateien gelesen. Die unterschriebene
  Vereinbarung wird zusätzlich hochgeladen.
- Jede Änderung (auch Reduktion) ist eine neue Vereinbarung.
- Onboarding: 7–8 Unterlagen, u. a. Einverständnis Stundenaufzeichnung, Bildaufnahme,
  Arbeitsanweisung (ca. 15 Punkte), Aushändigung Arbeitskleidung. Die vollständige Liste
  pflegt der Auftraggeber selbst.
- Jede Unterlage wird einzeln gespeichert, mit eigener Unterschrift.
- Die Bildaufnahme ist bei dieser Firma Voraussetzung für den Vertragsabschluss. Lehnt jemand
  ab, klärt die Geschäftsführung, ob eine Zusammenarbeit möglich ist. Ob eine Unterlage Pflicht
  oder freiwillig ist, bleibt aber eine **Einstellung je Unterlage** (andere Firmen, und ein
  möglicher Hinweis aus der rechtlichen Prüfung: Einwilligungen nach DSGVO müssen freiwillig sein).
- Jede Änderung an Stammdaten muss bekannt gegeben und nachgewiesen werden; der Stand zuvor
  muss nachvollziehbar bleiben.

## 8. Aufbau der Akte

Adresse in der App: `#akte/<dienstverhaeltnis-id>`. Der Name in der Mitarbeiterliste wird zum
Link. Reiter oben in der Akte:

1. **Übersicht**
   - Kopf: Name, Funktion, Arbeitsort (Vertragsbezeichnung), GmbH, Status
     (aktiv · befristet bis … · ausgetreten).
   - Hinweise oben, falls zutreffend: Nachweis fehlt (mit Datum der Anpassung),
     Versicherungsnummer wird nachgereicht, Befristung endet in X Tagen, Onboarding unvollständig.
   - Personendaten (Anrede, Geburtsdatum, Adresse), Kontakt.
   - Anstellung heute: Beschäftigungsart, Soll-Stunden pro Woche, Arbeitstage, Dienstantritt,
     Befristung. Gibt es eine künftige Anpassung: „ab 01.07.2026: 20 Stunden“.
   - Entgelt heute: Netto, Brutto (bzw. „offen“), Zulagen, 13./14. Gehalt.
   - Onboarding: „5 von 8“, Liste mit Häkchen bzw. „fehlt“; freiwillige Unterlage abgelehnt
     zählt als erledigt („abgelehnt“).
   - Resturlaub: „kommt mit der Stundenauswertung“.
2. **Stunden:** Platzhaltertext, dass dieser Bereich mit der Stundenauswertung kommt.
3. **Anstellung & Verlauf:** Tabelle aller Stände (gültig ab, Beschäftigungsart, Stunden, Tage,
   Netto, Brutto, Vereinbarung: vorhanden / Nachweis fehlt). Knopf „Stundenanpassung eintragen“.
4. **Dokumente:** gruppiert nach Kategorie: Anmeldung, Onboarding, Vereinbarungen, Abmeldung,
   Sonstiges. Je Dokument: Bezeichnung, Datum, hochgeladen von, Ansehen/Herunterladen.
   Knopf „Unterlage hochladen“.
5. **Lohnverrechnung:** Versicherungsnummer (mit „wird nachgereicht“), IBAN, BIC,
   Staatsangehörigkeit, jeweils mit Verlauf der früheren Werte. Ändern nur über
   „Änderung eintragen“ (§9a), nur Büro.
6. **Protokoll:** Änderungen an dieser Person aus `audit_log` (nur Büro).

Ein Reiter erscheint nur, wenn die Rolle die zugehörige Datenstufe sehen darf
(Übersicht immer, mit den erlaubten Teilen; Stunden immer als Platzhalter).

## 9. Stundenanpassung eintragen

Formular: gültig ab (Pflicht), Beschäftigungsart, Stunden pro Woche, Arbeitstage pro Woche,
Netto pro Monat. Vorbelegt mit dem aktuellen Stand. Daneben die Vorschau „vorher → nachher“
und das ermittelte Brutto.

- Es gelten dieselben Prüfregeln wie beim Dienstzettel (höchstens X Stunden pro Tag, Vollzeit =
  Firmenwert, Teilzeit darunter, geringfügig bis zur Grenze). Die Regeln stehen schon in
  `pruefungen.js` und in `dienstzettel_erfassen`; sie sollen gemeinsam genutzt werden, nicht
  kopiert.
- „gültig ab“ darf nicht vor dem Dienstantritt liegen und nicht vor dem letzten bestehenden
  Stand (keine rückwirkenden Einschübe zwischen zwei Stände; Korrekturen siehe unten).
- Beim Speichern entstehen in einem Schritt: ein Vertragsstand, ein Entgelt-Eintrag mit demselben
  Datum und ein Dokument „Vereinbarung Stundenanpassung“ ohne Datei (Status: Nachweis fehlt).
- Wer darf: nur Büro.
- Korrektur eines Tippfehlers: Ein Stand wird nie gelöscht. Ein falscher Stand kann vom Büro
  **storniert** werden (mit Grund); er bleibt sichtbar, zählt aber nicht mehr.

## 9a. Änderungen an Stammdaten (Entscheidung des Auftraggebers)

- In Übersicht (Personendaten, Kontakt) und Lohnverrechnung gibt es kein freies Bearbeiten,
  sondern „Änderung eintragen“: Feld(er), neuer Wert, gültig ab, Grund (Pflicht).
- Gespeichert wird ein Änderungseintrag mit altem und neuem Wert; danach gilt der neue Wert.
  Dazu entsteht ein Dokument „Nachweis Stammdatenänderung“ ohne Datei → „Nachweis fehlt“, bis
  der Nachweis (z. B. Formular, Heiratsurkunde, Bankbestätigung) hochgeladen ist.
- Ausnahme: Das **erstmalige** Eintragen einer nachgereichten Versicherungsnummer ist keine
  Änderung, sondern eine Ergänzung (Nachweis optional).
- Alte Werte sieht nur, wer die Datenstufe des Feldes sieht (IBAN/Versicherungsnummer nur mit
  Lohnverrechnung).
- Rückwirkend höchstens 90 Tage (wie beim Dienstzettel). *Entscheidung von Claude.*
- Wer darf: nur Büro.

## 10. Dokumente und Dateiablage

- Supabase Storage, ein **privater** Bereich (Bucket) für Personalakten.
  Ablage je Firma und Mitarbeiter; Dateinamen vergibt das System.
- Erlaubt: PDF, JPG, PNG, höchstens 10 MB je Datei.
- Ansehen nur über zeitlich begrenzte Links, nach denselben Rechten wie Datenstufe „Dokumente“.
- Hochladen erzeugt bzw. ergänzt einen Eintrag in `dokument` (Kategorie, Bezeichnung, optional
  Bezug zu einer Onboarding-Unterlage oder einem Vertragsstand, Fingerabdruck der Datei).
- **Nichts wird gelöscht.** Eine falsche Datei kann durch eine neue ersetzt werden; die alte
  bleibt als „ersetzt“ im Verlauf erhalten.
- Lädt man den Nachweis zu einer Stundenanpassung hoch, verschwindet „Nachweis fehlt“.
- **Sichtbarkeit je Kategorie** (*Entscheidung von Claude*, damit Dokumente nichts zeigen, was
  die Rolle sonst nicht sehen darf): Onboarding und Sonstiges → Stufe Dokumente;
  Vereinbarungen (enthalten Entgelt) → Dokumente **und** Entgelt; Anmeldung/Abmeldung und
  Nachweise zu Lohnverrechnungsdaten → Dokumente **und** Lohnverrechnung; Nachweise zu
  Personendaten → Dokumente **und** Personendaten. Gilt gleich für Tabelle und Dateiablage.

## 11. Onboarding-Unterlagen

- Neue Liste je Firma in den Einstellungen: Bezeichnung, Reihenfolge, Pflicht oder freiwillig,
  gilt für (Studio, Büro oder beide), aktiv. Vorbelegt für die Demo: Einverständnis
  Stundenaufzeichnung, Bildaufnahme (Pflicht), Arbeitsanweisung, Aushändigung Arbeitskleidung
  (nur Studio).
- Der Stand gehört zum **Dienstverhältnis** (bei Wiedereintritt neu). *Entscheidung von Claude.*
- Kommt eine Pflichtunterlage neu dazu, fehlt sie bei allen aktiven Mitarbeitern (gewollt: so
  wird das Nachholen sichtbar). Ausgetretene erscheinen nicht in „Wem fehlt was“.
  *Entscheidung von Claude.*
- **Abgelehnt** (bei Pflichtunterlagen): erzeugt den offenen Punkt „Klärung mit
  Geschäftsführung“, den nur das Büro schließen kann (mit Vermerk). Bei freiwilligen
  Unterlagen zählt „abgelehnt“ als erledigt.
- Stand je Mitarbeiter: erledigt (Dokument vorhanden), abgelehnt (nur bei freiwilligen),
  fehlt.
- Für „abgelehnt“ wird ebenfalls ein Dokument erwartet (die unterschriebene Ablehnung bzw. der
  Bogen mit „Nein“) oder ein Vermerk durch das Büro.

## 12. Liste „Wem fehlt was“

Neue Ansicht (für Büro und für Leitungen in ihrer Reichweite): je Mitarbeiter die offenen Punkte
– fehlende Onboarding-Unterlagen, Klärung mit Geschäftsführung, Stundenanpassungen ohne
Nachweis, Stammdatenänderungen ohne Nachweis, Versicherungsnummer nachzureichen. Filter nach
Arbeitsort und Art des Punkts. Klick führt in die Akte. Jeder Punkt erscheint nur, wenn die
Rolle die zugehörige Datenstufe sieht (z. B. „Stundenanpassung ohne Nachweis“ nur mit
Personendaten). *Entscheidung von Claude.*

## 13. Rechte in der Akte (Vorschlag, als Entscheidung von Claude markiert)

| Bereich | Sehen | Ändern |
|---|---|---|
| Übersicht | jede Rolle in ihrer Reichweite, Teile nach Datenstufen | – |
| Anstellung & Verlauf | Datenstufe Personendaten (Netto/Brutto nur mit Entgelt) | Büro |
| Dokumente | Datenstufe Dokumente, je Kategorie zusätzlich die passende Stufe (§10) | Büro; **Studio-/Regionalleitung dürfen Onboarding-Unterlagen für ihre zugeordneten Studios hochladen und „abgelehnt“ vermerken** (Nachholen vor Ort), aber nichts ersetzen. Das Recht hängt an der Rolle und an „Dokumente sehen“: wer keine Dokumente sieht, lädt auch nichts hoch. |
| Lohnverrechnung | Datenstufe Lohnverrechnung | Büro, nur über Änderungseintrag (§9a) |
| Eigene Akte (Rolle Mitarbeiter) | nicht Teil dieses Projekts; die bestehende Regel „eigene Dokumente“ bleibt unverändert | – |
| Protokoll | Büro | – |

## 14. Dem Bauenden überlassen

- Name und genaue Spalten der neuen Tabellen (z. B. `vertragsstand`, `onboarding_unterlage`),
  ob aktuelle Werte über eine Funktion/Ansicht oder gespeicherte Spalten ermittelt werden –
  solange es nur **eine** Quelle der Wahrheit gibt.
- Wie die Prüfregeln zwischen Dienstzettel und Stundenanpassung geteilt werden.
- Aufteilung des JavaScript in Dateien, Aufbau der Reiter, Darstellung am iPad.
- Tests: Datenbank-Tests je Rolle (wie bisher), Browser-Test mit simulierten Antworten.
- Ergänzung des Handbuchs (`docs/handbuch.md`) um Akte, Stundenanpassung, Dokumente,
  Onboarding-Liste.
