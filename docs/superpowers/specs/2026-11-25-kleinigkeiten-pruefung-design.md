# Kleinigkeiten aus der Prüfung der Unterschriftsmappe – Beschreibung

Stand: 25.11.2026 · Status: **Entwurf, wartet auf Freigabe durch Mansur**
Ablage im Repository später: `docs/superpowers/specs/2026-11-25-kleinigkeiten-pruefung-design.md`

Umfang (laut Entscheidung vom 25.11.): Punkte 1, 2 und 3. Punkt 4 (Papier-Upload und Unterschrift gleichzeitig) wird nach dieser Arbeit getrennt entschieden. Lange Wörter im PDF macht ein anderer Thread.

Es gilt weiter: nur Demo-Daten, nichts löschen, jede Änderung als **neue** Migration (026), Tests zuerst, Gesamttestlauf vor dem Veröffentlichen.

---

## 1. Fristanzeige zwischen 12:00:01 und 12:00:59

**Was heute passiert:**
- Das Formular (`app/frist.js`) liest die Wiener Uhrzeit nur auf die **Minute** genau. Um 12:00:30 sieht es „12:00“ und sagt „rechtzeitig“.
- Die Datenbank (`app.fruehester_dienstantritt`) vergleicht **sekundengenau**: 12:00:30 ist nach 12:00:00, also „nach der Stichzeit“. Sie lehnt den Dienstzettel ab.
- Folge: In diesen 59 Sekunden sieht man erst „passt“ und bekommt dann eine Fehlermeldung. Falsches wird nie gespeichert.

**Lösung:** Das Formular rechnet künftig auch mit Sekunden, genau wie die Datenbank. Die Regel bleibt: **bis einschließlich 12:00:00** zählt als „vor der Stichzeit“, ab 12:00:01 nicht mehr.

**Nicht geändert:** die Datenbank, die Einstellungen, die Regel selbst.

**Tests (zuerst, müssen vorher fehlschlagen):** in `tests/unit/frist.test.mjs`
- 12:00:00 Wiener Zeit → nächster Tag
- 12:00:30 Wiener Zeit → ein Tag dazwischen (heute falsch)
- 11:59:59 → nächster Tag; 12:01:00 → ein Tag dazwischen
- Zeitumstellung (Sommer/Winter) bleibt richtig

## 2. Hinweis an die Chefin, wenn sich Daten seit der Mitarbeiter-Unterschrift geändert haben

**Was heute passiert:**
- Unter „Zu unterschreiben“ sieht die Chefin den Dienstzettel **so, wie der Mitarbeiter ihn unterschrieben hat**. Das ist richtig und bleibt so (Beweissicherung).
- Wurde danach z. B. Adresse, Bank oder Name geändert, erfährt sie das nicht.

**Lösung: ein Hinweis, keine Sperre.**
- Die Datenbank sucht alle **Stammdatenänderungen** dieses Mitarbeiters seit dem Zeitpunkt seiner Unterschrift (Tabelle `stammdaten_aenderung`). Jede liefert ihren Feldnamen, z. B. „Straße“, „PLZ“, „IBAN“.
- Zusätzlich rechnet sie den Dienstzettel mit den **heutigen** Daten neu und vergleicht den Fingerabdruck. So fallen auch Änderungen auf, die keine Stammdaten sind: geänderte **Vertragstexte** (Textbausteine) oder Angaben zur **Firma** (GmbH-Adresse).
- Weicht etwas ab, zeigt die App
  - in der Liste „Zu unterschreiben“ eine Markierung **„Daten geändert“**,
  - beim Öffnen einen Hinweis: „Seit der Unterschrift des Mitarbeiters am [Datum] wurden geändert: Straße, PLZ, IBAN. Unterschrieben wird der Stand vom [Datum]. Soll der Dienstzettel neu unterschrieben werden: ‚Neu unterschreiben lassen‘.“
- Die Chefin kann trotzdem unterschreiben. Sie entscheidet selbst, ob sie stattdessen „Neu unterschreiben lassen“ wählt.
- Angezeigt werden nur die **Feldnamen**, nicht die neuen Werte. Die stehen in der Akte unter Stammdaten.
- Hinweis: IBAN, BIC und Versicherungsnummer stehen gar nicht auf dem Dienstzettel. Sie werden trotzdem genannt, damit die Chefin den vollen Überblick hat.

**Warum keine Sperre:** Eine neue Adresse macht einen unterschriebenen Dienstzettel nicht ungültig. Eine Sperre würde jede Kleinigkeit blockieren (Orientierung, keine Rechtsberatung).

**Reihenfolge (Entscheidung 25.11.):** Den Datenbank-Teil baue ich jetzt. Die sichtbare Markierung und den Hinweis baue ich erst, wenn das neue Design (Blau/Türkis) steht.

**Technik:**
- Migration 026: `arbeitgeber_offen()` bekommt die Spalte `geaendert` (ja/nein), `arbeitgeber_inhalt()` bekommt `geaendert` und `geaenderte_felder` (Liste von Anzeigenamen, ohne Doppelte, in fester Reihenfolge).
- Später, nach dem Design: `app/arbeitgeber.js` zeigt Markierung und Hinweis.
- Nichts am gespeicherten Dokument ändert sich.

**Tests (zuerst):**
- Datenbank (neuer Test `14_kleinigkeiten.sql`): unterschreiben, dann Straße ändern → `geaendert = true` und „Straße“ in der Liste; IBAN ändern → „IBAN“; ohne Änderung → `false`; Textbaustein geändert → „Vertragstexte“; Änderung **vor** der Unterschrift zählt nicht.
- Browser (`tests/ui`, später mit dem Design): Markierung und Hinweis erscheinen, Unterschreiben bleibt möglich.

## 3. `app.angemeldet` prüft die Firma nicht

**Was heute passiert:** Die Funktion sagt „angemeldet ja/nein“ für jedes Dienstverhältnis, auch einer fremden Firma. Es verrät nur ja/nein, und die IDs sind kaum zu erraten. Heute gibt es nur eine Firma, also kein echtes Problem. Für „mandantenfähig“ (jede Firma streng getrennt) ist es aber eine Lücke.

**Lösung:** Migration 026 legt `app.angemeldet` neu an: Sie antwortet nur für Dienstverhältnisse der **eigenen** Firma. Bei fremden gibt sie „nein“ zurück, ohne Fehler, damit Listen nicht abbrechen.

**Geprüft:** Die Edge Function nutzt `app.angemeldet` nicht, sie ist also nicht betroffen.

**Tests (zuerst):** in `14_kleinigkeiten.sql`: eigene Firma, angemeldet → ja; fremde Firma, angemeldet → nein; Akte-Kopf und Mitarbeiterliste zeigen weiter richtig.

---

## Ablauf nach Freigabe
1. Plan schreiben (`docs/superpowers/plans/2026-11-25-kleinigkeiten-pruefung.md`), du gibst ihn frei.
2. Je Punkt: Test schreiben, rot sehen, Code, grün.
3. Gesamttestlauf (Datenbank 01–14, `tests/lauf.sh`), `get_advisors`.
4. Unabhängige Prüfung, Funde beheben.
5. Zusammenführen und veröffentlichen erst mit deiner Freigabe.

## Entscheidungen (25.11.2026)
1. Punkt 2: **Hinweis statt Sperre**. Bestätigt von Mansur.
2. Punkt 2: Die **Namen der geänderten Felder** werden genannt, für einen genaueren Überblick im späteren Verlauf. Bestätigt von Mansur.
