# Startseite mit Kennzahlen – Beschreibung (Stand 25.11.2026)

## Wunsch
Mansur (25.11.2026): „Bau mir eine echte Startseite.“ Die bisherige Einstiegsseite war die Dienstzettel-Erfassung.
Gewünscht: jede Art von Analyse, aktuelle Fluktuation in Prozent, Anmeldungen und Abmeldungen im letzten Monat,
Jahresübersicht, die wichtigsten Mitarbeiterdaten auf einen Blick. Das ganze Jahr und der aktuelle Monat sollen sichtbar sein.
Die gesamte Analyse muss als PDF herunterladbar sein.

Mansur hat „einfach drauf los bauen“ gewählt (keine eigene Freigabe von Beschreibung und Plan); diese Datei hält fest, was gebaut wurde.

## Entscheidungen
- **Fluktuation: Option C** (von Mansur gewählt): Fluktuation der letzten 12 Monate
  (Austritte ÷ Ø Monatsend-Stand × 100) plus **Frühfluktuation** (Anteil der Austritte in der Probezeit).
  Zusätzlich Monats- und Jahresfluktuation.
- **Datenquelle:** nur `mitarbeiter_verzeichnis` (+ `entgelt` mit Entgelt-Recht, `offene_punkte`, `arbeitgeber_offen`).
  Keine Migration nötig. Die Datenbank filtert schon nach Reichweite und Datenstufen.
- **Rollen:** keine neuen fest eingebauten Rollenlisten. Was gezeigt wird, hängt an den Rechten
  (`sieht_personendaten`, `sieht_entgelt`, `darf_arbeitgeber_unterschreiben`) und an dem, was die Datenbank liefert.
- **Gerechnet wird im Browser** (`app/kennzahlen.js`, reine Funktionen, Einheitstests).
- **PDF zum Herunterladen** (Entscheidung Mansur 25.11.2026, Option „Server-PDF, Admin ändert auch“):
  - Neues Recht `darf_analyse_export` („Analyse herunterladen“), Voreinstellung Admin und GF.
    Gedacht für die Geschäftsleitung, täglich oder wöchentlich.
  - `vergibt_analyse_export`: wer das Recht setzen oder entziehen darf (Admin und GF). Nur über
    `public.analyse_recht_setzen`, direktes Ändern sperrt ein Trigger. Jede Änderung im Protokoll.
  - Edge Function `analyse` erzeugt das PDF (pdf-lib, DejaVu-Schrift wie die Mappe) mit dem Zugang der Person.
    Vorher vermerkt `public.analyse_export_vermerken` den Download im Protokoll; ohne Recht kommt eine Meldung und kein PDF.
  - Verworfen: nur Knopf ausblenden (kein echter Schutz) und „nur GF vergibt“ (Mansur möchte, dass auch der Admin vergeben darf).
  - Der frühere Druckdialog ist entfernt.
- **Aussehen:** an die freigegebene Design-Vorschau angelehnt (Glas-Karten, Blau-Verlauf). Alle Farben stehen als
  Variablen `--sz-*` in `app/startseite.css`, damit der Design-Umbau sie übernehmen kann.
- Die Dienstzettel-Erfassung bleibt eigene Seite („Neuer Mitarbeiter“).

## Abhängigkeiten
- **Austritt-Modul:** Heute kann die App kein Austrittsdatum setzen. Bis dahin zeigt die Startseite einen Hinweis.
  Sobald das Modul `dienstverhaeltnis.austritt` füllt, zählen Austritte und Fluktuation automatisch.
  Zu klären mit dem Modul: (a) zählt ein Austritt erst nach Bestätigung durch das Büro (Empfehlung: ja, `austritt`
  erst dann setzen), (b) „nicht angetreten“ sollte weder als Eintritt noch als Austritt zählen
  (das Verzeichnis braucht dafür ein Kennzeichen, die Startseite filtert es dann aus).
- **Design-Umbau:** Seitenleiste und Schrift kommen aus dem Design-Thread.

## Nicht enthalten
- Abmeldungen als eigener Status (kommt mit dem Austritt-Modul), Krankenstand, Urlaub, Überstunden.
- Personalkosten mit Zulagen und Lohnnebenkosten (nur Brutto laut Dienstzettel).
