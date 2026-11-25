# Lange Wörter im PDF umbrechen: Konzept

Stand: 25.11.2026 · Auftraggeber: Mansur Khaydayev · Projekt: Staff-Solutions

## 1. Worum es geht und warum

Die Edge Function `mappe` erzeugt die PDFs der Unterschriftsmappe (Dienstzettel, Onboarding-Unterlagen).
Der Zeilenumbruch in `supabase/functions/mappe/pdf.js` trennt nur an Leerzeichen. Ein einzelnes Wort,
das breiter als die Zeile ist (z. B. ein langer Firmenname, eine E-Mail-Adresse oder ein zusammengesetztes
Wort), läuft deshalb über den rechten Rand hinaus. Das war eine der aufgeschobenen Kleinigkeiten aus der
Prüfung der Unterschriftsmappe.

## 2. Entscheidung zu den Sonderzeichen (25.11.2026)

Ursprünglich sollte hier auch eine Unicode-Schrift eingebaut werden, damit ć č đ ş ı ğ im PDF erscheinen.
**Das entfällt.** In der Firma werden Namen ohne diese Zeichen geschrieben (z. B. „Ivana Ciric“).
Es bleibt bei Helvetica. Die bestehende Absicherung bleibt: Ein Zeichen, das die Schrift nicht kennt, wird
als „?“ gedruckt, statt dass das PDF scheitert.

## 3. Ziel

Ein Wort, das breiter als der verfügbare Platz ist, wird hart an der Zeilenbreite getrennt. Am Ende jeder
getrennten Zeile steht ein Bindestrich. Das gilt überall, wo umgebrochen wird: Titel, Untertitel,
Feldwerte (rechte Spalte) und Abschnittstexte.

## 4. Nicht-Ziele

- Keine neue Schrift, keine neue Abhängigkeit.
- Keine Silbentrennung nach Wörterbuch (die Trennung ist rein nach Breite).
- Kein Umbau des Layouts. Normale Texte brechen genau wie bisher um.
- Keine Änderung an Datenbank, Fassung (`app.fassung`) oder App. Bereits abgelegte PDFs bleiben, wie sie sind.

## 5. Lösung

**In `pdf.js`, Funktion `umbrechen()`:** Passt ein Wort allein nicht in die Zeile, wird es in Stücke
geteilt. Jedes Stück ist so lang wie möglich, sodass es samt Bindestrich in die Zeile passt. Das letzte
Stück wird wie ein normales Wort weiterverwendet, danach kann normaler Text in derselben Zeile folgen.

**Tests zuerst (in `tests/unit/mappe_pdf.test.mjs`, müssen vorher rot sein):**
- Ein überlanges Wort im Abschnittstext: Keine Textzeile im PDF ragt über den rechten Rand hinaus,
  und der Text ist ohne die Trenn-Bindestriche vollständig im PDF.
- Dasselbe für einen Feldwert in der rechten Spalte.
- Normaler Text bricht unverändert um (die bestehenden Tests bleiben grün).

## 6. Veröffentlichen

1. Alle Tests mit `bash tests/lauf.sh`.
2. Unabhängige Prüfung des Stands.
3. Deploy der Edge Function als **Version 3** (`index.ts`, `ablauf.js`, `pdf.js`; geändert ist nur
   `pdf.js`) mit `verify_jwt: true`, erst nach Freigabe.
4. Zusammenführen nach `main`. Netlify ist nicht betroffen.
5. `projekt-kontext.md`: Punkt „Sonderzeichen im PDF“ als „nicht nötig“ vermerken, Kleinigkeit
   „Sehr lange Wörter“ abhaken.

**Rückweg:** Version 2 der Edge Function wieder einspielen. Es gehen keine Daten verloren.
