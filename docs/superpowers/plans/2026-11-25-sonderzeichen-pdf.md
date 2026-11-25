# Sonderzeichen und lange Wörter im PDF – Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Die Edge Function `mappe` druckt Namen mit ć č đ ş ı ğ (und Kyrillisch/Griechisch) richtig und trennt überlange Wörter mit Bindestrich, statt über den Rand zu schreiben.

**Aufbau:** Eine auf Latein, Griechisch und Kyrillisch gekürzte DejaVu Sans (normal, fett) liegt als Base64 in `supabase/functions/mappe/schrift.js`. `pdf.js` bekommt sie zusammen mit `fontkit` übergeben (wie heute `pdf-lib`) und bettet sie mit `subset: true` ein. `umbrechen()` trennt Wörter, die breiter als die Zeile sind.

**Technik:** pdf-lib 1.17.1, `@pdf-lib/fontkit` 1.1.1 (Deno: `npm:@pdf-lib/fontkit@1.1.1`; lokal global installiert), DejaVu Sans aus `dejavu-fonts-ttf@2.37.3` (npm), Python `fonttools` zum Kürzen, Node 22 `node:test`, pdfjs-dist.

**Konzept:** `docs/superpowers/specs/2026-11-25-sonderzeichen-pdf-design.md` (freigegeben 25.11.2026).

## Globale Vorgaben

- Alle Vorgaben aus den bisherigen Plänen gelten weiter (Demo-Daten, keine Schlüssel im Code, nichts löschen, deutsche Texte, Attributionszeilen in Commits, Push mit `git -c push.negotiate=true push`).
- Keine Änderung an Datenbank, App (`app/`) oder `app.fassung`. Bereits abgelegte PDFs werden nicht neu erzeugt.
- Zeichenbereiche der Schrift (genau so): `U+0020-007E, U+00A0-024F, U+0300-036F, U+0370-03FF, U+0400-04FF, U+1E00-1EFF, U+2000-206F, U+20AC, U+2122, U+2190-2193, U+2713, U+2714, U+2717`.
- Layout, Größen (`SCHRIFT = 10`, `ZEILE = 14`, Titel 16, Kopf 9, Fuß 8) und Fußzeilentext bleiben unverändert.
- Zeichen, die die Schrift nicht kennt, werden als `?` gedruckt. Ein PDF entsteht immer.
- Trenn-Bindestrich: `-` (U+002D) am Ende jeder getrennten Zeile.
- Deploy der Edge Function (Version 3) und Push/Zusammenführen erst nach komplettem Testlauf, unabhängiger Prüfung und Mansurs Freigabe.

## Review Focus

1. **Zerlegte Akzente** (z. B. „c“ + U+0301 aus einer kopierten Liste): Text wird vor dem Prüfen mit `normalize("NFC")` zusammengesetzt und erscheint als „ć“. Test in Aufgabe 2.
2. **Emoji oder chinesische Zeichen** im Namen: kein Absturz, an der Stelle steht `?`. Test in Aufgabe 2.
3. **Überlanges Wort im fetten Titel (16 pt)** und in der schmalen rechten Feldspalte: bleibt innerhalb des Rands. Test in Aufgabe 3.
4. **Leere Werte / `null`** in Feldern und Kopf: PDF entsteht wie bisher ohne Fehler. Bestehende Tests decken `null` im Untertitel ab; Test für leeren Feldwert in Aufgabe 2.
5. **Unterschriftsbeschriftung und Ort mit Sonderzeichen** (z. B. Ort „Čakovec“): gehen auch über die neue Schrift. Test in Aufgabe 2.

---

### Aufgabe 1: Gekürzte Schrift erzeugen

**Dateien:**
- Neu: `generator/schrift_kuerzen.py`
- Neu (erzeugt): `supabase/functions/mappe/schrift.js`
- Neu: `supabase/functions/mappe/LICENSE-DejaVu.txt` (aus dem npm-Paket kopiert)
- Neu: `tests/unit/mappe_schrift.test.mjs`
- Ändern: `tests/unit/_global.mjs` (Export `fontkit`)

**Schnittstellen:**
- Liefert: `schrift.js` mit `export const DEJAVU_NORMAL: Uint8Array` und `export const DEJAVU_FETT: Uint8Array` (aus Base64 dekodiert mit `atob`, läuft in Deno und Node). Kopfkommentar: Quelle, Version 2.37.3, Zeichenbereiche, Aufruf des Skripts, Lizenzhinweis.
- Liefert: `_global.mjs` exportiert zusätzlich `fontkit` (global installiertes `@pdf-lib/fontkit`, Default-Export) und `schrift = { fontkit, normal: DEJAVU_NORMAL, fett: DEJAVU_FETT }`.

- [ ] **Schritt 1: Test schreiben** – `mappe_schrift.test.mjs`:
  - `"Schrift: beide Schnitte sind TrueType"`: erste 4 Bytes von `DEJAVU_NORMAL` und `DEJAVU_FETT` sind `00 01 00 00`.
  - `"Schrift: alle nötigen Zeichen vorhanden"`: `fontkit.create(Buffer.from(DEJAVU_NORMAL)).hasGlyphForCodePoint(cp)` ist wahr für jedes Zeichen in `"ĆćČčĐđŞşİıĞğŠšŽžŒœäöüß€§–„“Шевченкоλ"`, ebenso für `DEJAVU_FETT`.
  - `"Schrift: klein genug"`: Größe von `schrift.js` unter 450 000 Bytes.
- [ ] **Schritt 2:** `node --test tests/unit/mappe_schrift.test.mjs` → FAIL (Modul `schrift.js` fehlt).
- [ ] **Schritt 3:** `generator/schrift_kuerzen.py <ordner-mit-DejaVuSans.ttf>` schreiben: kürzt `DejaVuSans.ttf` und `DejaVuSans-Bold.ttf` mit `fontTools.subset` (Zeichenbereiche aus den Globalen Vorgaben, `layout_features=['*']`) und schreibt `supabase/functions/mappe/schrift.js`. Ausführen mit den Dateien aus `npm pack dejavu-fonts-ttf@2.37.3` (in einem leeren Ordner unter `/tmp` entpacken). `LICENSE` aus dem Paket als `LICENSE-DejaVu.txt` ablegen.
- [ ] **Schritt 4:** Test erneut → PASS.
- [ ] **Schritt 5:** Commit „Schrift: gekürzte DejaVu Sans für die Mappe“.

### Aufgabe 2: PDF mit DejaVu Sans

**Dateien:**
- Ändern: `supabase/functions/mappe/pdf.js` (Einbetten, `text()`)
- Ändern: `supabase/functions/mappe/ablauf.js:63,90` (Schrift durchreichen)
- Ändern: `supabase/functions/mappe/index.ts` (Import fontkit + schrift.js, `abh.schrift`)
- Ändern: `supabase/functions/mappe/muster.mjs` (Schrift übergeben)
- Ändern: `tests/unit/mappe_pdf.test.mjs`, `tests/unit/mappe_ablauf.test.mjs` (Schrift übergeben bzw. in `abh`)

**Schnittstellen:**
- Nutzt: `schrift` aus Aufgabe 1.
- Liefert: `pdfErstellen(lib, inhalt, unterschriften = {}, schrift)` mit `schrift = { fontkit, normal: Uint8Array, fett: Uint8Array }`. Fehlt `schrift`, wirft sie `Error("Schrift fehlt")`.
- Liefert: `abh.schrift` (gleiche Form) in `index.ts`; `ablauf.js` ruft `pdfErstellen(abh.pdfLib, …, …, abh.schrift)`.

- [ ] **Schritt 1: Tests schreiben** in `mappe_pdf.test.mjs` (alle Aufrufe bekommen `schrift` als 4. Argument):
  - `"Namen mit ć č đ ş ı ğ erscheinen richtig"`: Feldwert `"Frau Ivana Ćirić, Đurđević, Şahin Işık Doğan"` steht genau so im PDF-Text.
  - `"Kyrillisch und Griechisch"`: `"Олена Шевченко, Αλέξανδρος"` steht genau so im PDF-Text.
  - `"Zerlegte Akzente werden zusammengesetzt"`: Eingabe `"Ciric".replace("C", "Ć")` → PDF-Text enthält `"Ćiric"`.
  - `"Unbekannte Zeichen werden zu ?"`: Feldwert `"Anna 😀 王"` → PDF entsteht, Text enthält `"Anna ? ?"`.
  - `"Ort mit Sonderzeichen bei der Unterschrift"`: `mitarbeiter: { png: MINI_PNG, ort: "Čakovec", datum: "24.11.2026" }` → Text enthält `"Čakovec, 24.11.2026"`.
  - `"Leerer Feldwert"`: `felder = [["Notiz", ""], ["Titel", null]]` → PDF entsteht ohne Fehler.
  - `"Ohne Schrift: Fehler"`: `pdfErstellen(pdfLib, demoDienstzettel(), {})` wirft `/Schrift fehlt/`.
  - Der bisherige Test „Namen mit Š, ž, Œ (WinAnsi)“ bleibt (umbenannt in „Namen mit Š, ž, Œ“).
- [ ] **Schritt 2:** `node --test tests/unit/mappe_pdf.test.mjs` → die neuen Tests FAIL (Fragezeichen statt Buchstaben bzw. kein Fehler ohne Schrift).
- [ ] **Schritt 3:** `pdf.js` ändern: `dok.registerFontkit(schrift.fontkit)`, `normal`/`fett` mit `dok.embedFont(bytes, { subset: true })`. `text(t)` wird zu `text(t, font)`: `String(t ?? "")`, Tabs zu Leerzeichen, `normalize("NFC")`, jedes Zeichen außer `\n`, das nicht in `font.getCharacterSet()` liegt, wird `?` (Menge einmal je Schrift als `Set` merken). `WINANSI_EXTRA` entfällt. `ablauf.js`, `index.ts` (`import fontkit from "npm:@pdf-lib/fontkit@1.1.1"`, `import { DEJAVU_NORMAL, DEJAVU_FETT } from "./schrift.js"`), `muster.mjs` und `mappe_ablauf.test.mjs` (`abh.schrift = schrift`) anpassen.
- [ ] **Schritt 4:** `node --test tests/unit/*.test.mjs` → alle PASS.
- [ ] **Schritt 5:** Prüfen, dass `index.ts` in Deno lädt: `npx deno check supabase/functions/mappe/index.ts` (Deno über `npm i -g deno`; nur Prüfung, nicht im Repository). Erwartet: keine Fehler.
- [ ] **Schritt 6:** Commit „PDF: Unicode-Schrift statt Helvetica“.

### Aufgabe 3: Überlange Wörter trennen

**Dateien:**
- Ändern: `supabase/functions/mappe/pdf.js` (`umbrechen()`)
- Ändern: `tests/unit/_global.mjs` (Helfer `pdfZeilen`)
- Ändern: `tests/unit/mappe_pdf.test.mjs`

**Schnittstellen:**
- Liefert: `pdfZeilen(bytes) -> Promise<Array<{ seite: number, str: string, x: number, breite: number }>>` in `_global.mjs` (aus pdfjs `getTextContent`: `x = transform[4]`, `breite = width`).

- [ ] **Schritt 1: Tests schreiben**:
  - Konstante `RECHTS = 595.28 - 56` und `LANG = "Arbeitnehmerüberlassungsvertragsbestandteilsergänzungsvereinbarungsdokumentationsablage".repeat(2)`.
  - `"Langes Wort im Abschnitt bleibt im Rand"`: Abschnittstext `` `Vorher ${LANG} nachher` `` → jede Zeile aus `pdfZeilen` erfüllt `x + breite <= RECHTS + 0.5`; der zusammengefügte Text ohne `"-"` am Zeilenende enthält `LANG`, `"Vorher"` und `"nachher"`.
  - `"Langes Wort im Feldwert bleibt im Rand"`: gleiche Prüfung für Feld `["E-Mail", LANG]`.
  - `"Langes Wort im Titel bleibt im Rand"`: `titel = LANG` (fett, 16 pt), gleiche Prüfung.
  - `"Normaler Text bricht wie bisher um"`: Abschnitt `"Ein längerer Absatz mit Text. ".repeat(8)` → keine Zeile endet mit `"-"`.
- [ ] **Schritt 2:** Tests → die drei „bleibt im Rand“-Tests FAIL, „Normaler Text“ PASS.
- [ ] **Schritt 3:** `umbrechen(t, font, groesse, max)` ändern: Passt ein Wort allein nicht in `max`, wird es in Stücke zerlegt; jedes Stück ist das längste Präfix, für das `widthOfTextAtSize(stück + "-") <= max` gilt, mindestens 1 Zeichen (keine Endlosschleife). Stücke außer dem letzten werden mit `-` als eigene Zeile ausgegeben, das letzte wird wie ein normales Wort weiterverwendet.
- [ ] **Schritt 4:** `node --test tests/unit/*.test.mjs` → alle PASS.
- [ ] **Schritt 5:** Commit „PDF: überlange Wörter mit Bindestrich trennen“.

### Aufgabe 4: Muster, Doku, Gesamttest

**Dateien:**
- Neu erzeugt: `docs/muster/dienstzettel-muster.pdf`, `docs/muster/onboarding-muster.pdf`
- Ändern: `docs/handbuch.md` (Abschnitt zum PDF: Schrift DejaVu Sans, Sonderzeichen, Trennung; wie man `schrift.js` neu erzeugt)

- [ ] **Schritt 1:** `NODE_PATH=$(npm root -g) node supabase/functions/mappe/muster.mjs docs/muster` → zwei PDFs. Mit `pdftoppm` als Bild ansehen: Layout wie bisher, nur andere Schrift, nichts über dem Rand.
- [ ] **Schritt 2:** Handbuch ergänzen.
- [ ] **Schritt 3:** `bash tests/lauf.sh` → alle Einheits- und Browser-Tests PASS (Ausgangsstand: 59 Einheitstests grün).
- [ ] **Schritt 4:** Commit „Muster-PDFs mit neuer Schrift, Handbuch“.

### Aufgabe 5: Prüfung und Veröffentlichung

- [ ] **Schritt 1:** Unabhängiger Prüfer (frische Sitzung, stärkstes Modell, `superpowers:requesting-code-review`) über den ganzen Zweig gegen Konzept und Plan. Wichtige Funde mit Test zuerst beheben.
- [ ] **Schritt 2:** `bash tests/lauf.sh` erneut nach den Korrekturen → PASS.
- [ ] **Schritt 3:** Mansur Muster-PDFs zeigen und Freigabe für Deploy, Push und Zusammenführen einholen.
- [ ] **Schritt 4:** Nach Freigabe: `deploy_edge_function` „mappe“ mit `index.ts`, `ablauf.js`, `pdf.js`, `schrift.js`, `verify_jwt: true` → Version 3. `get_advisors`: nur die bekannten Hinweise.
- [ ] **Schritt 5:** Zusammenführen nach `main`, pushen (`git -c push.negotiate=true push`). `projekt-kontext.md` (Abschnitt 5): Sonderzeichen und „Sehr lange Wörter“ abhaken.
- [ ] **Schritt 6:** Erster echter Test am iPad mit Demo-Namen „Ivana Ćirić“ (macht Mansur).

**Nachtrag beim Bauen (25.11.2026):** Statt DejaVu Sans wird **DejaVu Sans Condensed** verwendet (gleiche
Schriftfamilie und Lizenz). Die normale DejaVu Sans ist rund 13 % breiter als Helvetica, dadurch rutschten im
Muster-Dienstzettel die Unterschriften auf eine zweite Seite. Condensed ist nur rund 2 % breiter, das Muster
bleibt einseitig wie bisher. `schrift.js` ist damit rund 300 KB groß.
