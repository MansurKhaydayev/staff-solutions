# Kleinigkeiten aus der Prüfung – Plan

Stand: 25.11.2026 · Status: **Entwurf, wartet auf Freigabe durch Mansur**
Gehört zu: `docs/superpowers/specs/2026-11-25-kleinigkeiten-pruefung-design.md`
Ablage im Repository später: `docs/superpowers/plans/2026-11-25-kleinigkeiten-pruefung.md`

**Jetzt:** Punkt 1, Punkt 3, Datenbank-Teil von Punkt 2. **Nach dem neuen Design:** Anzeige von Punkt 2 (Aufgabe 5).
Arbeitsweise: je Aufgabe zuerst der Test, rot sehen, dann Code, grün sehen. Zweig `kleinigkeiten-pruefung`, nichts direkt auf `main`.

---

## Aufgabe 0: Vorbereitung
- Zweig `kleinigkeiten-pruefung` von `main` anlegen.
- Ausgangslage festhalten: `bash tests/lauf.sh` grün (am 25.11. geprüft), Datenbank-Tests 01–13 über `execute_sql` grün.

## Aufgabe 1: Fristanzeige sekundengenau (`app/frist.js`)
1. **Test** in `tests/unit/frist.test.mjs` ergänzen:
   - 12:00:30 Wiener Zeit → ein Tag dazwischen (Mittwoch → Freitag). *Muss heute fehlschlagen.*
   - 12:00:00 → nächster Tag, 11:59:59 → nächster Tag.
   - Sommerzeit (+02:00) 12:00:30 → ein Tag dazwischen.
   - Stichzeit mit Sekunden („11:30:15“) wird richtig gelesen.
2. **Code:** `wienTeile` liefert Sekunden des Tages (`second` mitlesen), Stichzeit als Stunden:Minuten:Sekunden lesen, Vergleich `sekunden <= stichzeit`. Gleiche Regel wie `p_zeitpunkt::time <= anmeldung_stichzeit` in der Datenbank.
3. `bash tests/lauf.sh` grün.

## Aufgabe 2: `app.angemeldet` nur für die eigene Firma (Migration 026, Teil A)
1. **Test** `supabase/tests/14_kleinigkeiten.sql` (endet mit `rollback`):
   - Mitarbeiter der Demo-Firma mit Anmeldebestätigung → `app.angemeldet` = ja.
   - Eine zweite Test-Firma mit angemeldetem Mitarbeiter anlegen; als HR der Demo-Firma gefragt → nein. *Muss heute fehlschlagen.*
   - Akte-Kopf und Mitarbeiterliste zeigen weiter „angemeldet“ richtig (Test 10 bleibt grün).
2. **Code:** Migration `20261125000026_kleinigkeiten.sql`: `create or replace function app.angemeldet` mit zusätzlicher Bedingung `x.organisation_id = app.organisation_id()`. Keine `drop`/`revoke` nötig, die Rechte bleiben erhalten.
3. Vorher prüfen, ob `app.angemeldet` irgendwo als Dienst (ohne Firma) aufgerufen wird. Stand heute: nein (nur Akte-Kopf, Verzeichnis, offene Punkte).

## Aufgabe 3: Erkennen geänderter Daten (Migration 026, Teil B)
1. **Test** in `14_kleinigkeiten.sql`:
   - Dienstzettel unterschreiben lassen (wie in Test 13), dann `arbeitgeber_inhalt` → `geaendert = false`, leere Liste.
   - Straße ändern (über die normale Stammdaten-Funktion) → `geaendert = true`, Liste enthält „Straße“.
   - Zusätzlich IBAN ändern → „Straße“ und „IBAN“, jedes Feld nur einmal.
   - Textbaustein ändern → „Vertragstexte“.
   - Änderung **vor** der Unterschrift zählt nicht.
   - `arbeitgeber_offen()` zeigt `geaendert` für denselben Fall.
   - Nur wer Arbeitgeber-Unterschrift darf, bekommt die Angaben (bestehende Rechteprüfung bleibt).
2. **Code:** in derselben Migration
   - Hilfsfunktion `app.dienstzettel_aenderungen(p_dokument_id uuid) returns text[]`:
     - Feldnamen aus `stammdaten_aenderung` für den Mitarbeiter mit `created_at` nach der Mitarbeiter-Unterschrift.
     - Fingerabdruck von `app.dienstzettel_inhalt` heute gegen `inhalt_hash`; weicht er ab, Zeilen vergleichen: Textbausteine → „Vertragstexte“, andere geänderte Zeilen mit ihrem Titel (z. B. „Arbeitgeber“), sofern nicht schon durch Stammdaten erklärt.
   - `arbeitgeber_inhalt` und `arbeitgeber_offen` neu anlegen mit den neuen Angaben. Für `arbeitgeber_offen` ändert sich die Ergebnis-Tabelle: Postgres verlangt dafür `drop function`. **Ausweg ohne `drop`:** Die Liste bekommt die neue Spalte über eine zusätzliche Funktion `arbeitgeber_offen_hinweise()`, oder die App holt `geaendert` beim Öffnen. Entscheidung beim Bauen nach Test, ich bevorzuge die zusätzliche Funktion.
3. Datenbank-Tests 01–14 grün.

## Aufgabe 4: Gesamtprüfung für den Technik-Teil
1. Gesamttestlauf: `bash tests/lauf.sh` und Datenbank-Tests 01–14.
2. `get_advisors`: nur die bekannten Hinweise.
3. Unabhängiger Prüfer über den ganzen Zweig, Funde mit Tests beheben.
4. Handbuch (`docs/handbuch.md`) und `projekt-kontext.md` ergänzen (Punkte 1 und 3 abhaken).
5. **Mit deiner Freigabe:** Migration einspielen, zusammenführen, pushen. Die App ändert sich sichtbar nur bei Punkt 1 (richtige Fristanzeige).

## Aufgabe 5 (nach dem neuen Design): Anzeige des Hinweises
1. **Browser-Test** in `tests/ui` mit `tests/ui/mock.js`: Markierung „Daten geändert“ in der Liste, Hinweis mit Feldnamen beim Öffnen, Unterschreiben bleibt möglich, ohne Änderung kein Hinweis.
2. **Code:** `app/arbeitgeber.js` und Stil im neuen Design.
3. Gesamttestlauf, Prüfung, mit Freigabe veröffentlichen.

## Was ich zum Bauen von dir brauche
- Freigabe von Beschreibung und Plan.
- Für Aufgabe 4: Push-Recht auf das Repository (ich hänge es dann mit Push-Recht an) und deine Freigabe zum Einspielen der Migration in Supabase.
