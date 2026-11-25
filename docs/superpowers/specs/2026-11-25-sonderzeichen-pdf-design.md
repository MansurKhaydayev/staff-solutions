# Sonderzeichen und lange Wörter im PDF: Konzept

Stand: 25.11.2026 · Auftraggeber: Mansur Khaydayev · Projekt: Staff-Solutions · **freigegeben am 25.11.2026**

## 1. Worum es geht und warum

Die Edge Function `mappe` erzeugt die PDFs der Unterschriftsmappe (Dienstzettel, Onboarding-Unterlagen).
Sie nutzt heute die eingebaute Standardschrift **Helvetica**. Diese Schrift kennt nur westeuropäische
Zeichen (Fachbegriff „WinAnsi“). Umlaute, ß, €, Š, ž und Œ gehen, aber **ć č đ ş ı ğ** und viele weitere
Buchstaben nicht. Damit das PDF trotzdem entsteht, ersetzt `pdf.js` sie heute durch „?“.

Bei Namen wie *Ćirić*, *Đurđević*, *Işık* oder *Doğan* steht also ein falscher Name im unterschriebenen
Dokument. Das passt nicht zum Leitgedanken **„Alles muss nachweisbar sein“**: Das PDF muss genau zeigen,
was in der Datenbank steht.

Dazu kommt eine Kleinigkeit aus der Prüfung: **Sehr lange einzelne Wörter laufen über den Rand**, weil der
Zeilenumbruch nur an Leerzeichen trennt.

## 2. Ziele

1. Alle Buchstaben, die in Namen und Adressen in Europa vorkommen, erscheinen im PDF richtig: Latein mit
   allen Erweiterungen (z. B. Kroatisch, Serbisch in lateinischer Schrift, Tschechisch, Polnisch,
   Ungarisch, Rumänisch, Türkisch, Vietnamesisch), dazu €, §, Gedankenstriche und Anführungszeichen.
2. Der Text im PDF lässt sich weiterhin richtig kopieren und durchsuchen (z. B. „Ćirić“ findet „Ćirić“).
3. Ein Wort, das breiter als die Zeile ist, wird mit Bindestrich auf mehrere Zeilen getrennt. Nichts läuft
   über den Rand, auch nicht in der Spalte rechts neben den Feldbezeichnungen.
4. Das Layout bleibt so, wie die Chefin es kennt: Aufbau, Größen und Fußzeile ändern sich nicht. Nur die
   Schriftart wechselt von Helvetica zu DejaVu Sans, die sehr ähnlich aussieht.
5. Die Edge Function braucht beim Erzeugen **kein Internet** für die Schrift.

## 3. Nicht-Ziele

- Keine Schriften für Arabisch, Hebräisch, Chinesisch usw. Kyrillisch und Griechisch sind dabei (Abschnitt 7).
- Kein Umbau des PDF-Layouts, keine neue Silbentrennung nach Wörterbuch.
- Keine Änderung an der Datenbank, an der Fassung (`app.fassung`) oder an der App.
- Bereits abgelegte PDFs werden **nicht** neu erzeugt. Sie bleiben, wie sie sind (Beweissicherung).

## 4. Entscheidung: Wie kommt die Schrift in die Edge Function

Entschieden am 25.11.2026: **Variante A, gekürzte Schrift im Code.**

In der Praxis schreibt die Firma Namen ohne diese Zeichen (z. B. „Ivana Ciric“). Die Schrift kommt trotzdem,
**als Absicherung**, falls doch einmal ein solcher Name eingegeben wird (Entscheidung vom 25.11.2026).

- Freie Schrift **DejaVu Sans** (normal und fett), Lizenz erlaubt Weitergabe und Einbetten.
- Vorher auf die benötigten Zeichenbereiche gekürzt: von rund 750 KB auf rund 150 KB je Schnitt (mit Kyrillisch und Griechisch).
- Die gekürzte Schrift liegt als Textdatei (Base64) im Ordner der Edge Function, weil das Hochladen der
  Edge Function nur Textdateien annimmt. Ins PDF kommen nur die tatsächlich benutzten Buchstaben,
  das PDF bleibt also klein (heute rund 8 bis 18 KB).
- Verworfen: B (ganze Schrift, rund 1,5 MB) und C (Schrift aus dem Internet laden, Ausfallrisiko am iPad).

## 5. Lösung im Detail

**Neue Dateien in `supabase/functions/mappe/`:**
- `schrift.js`: die zwei gekürzten Schriften als Base64-Text, dazu ein Kommentar, wie sie entstanden sind.
- `LICENSE-DejaVu.txt`: die Lizenz der Schrift.

**Neues Hilfsskript `generator/schrift_kuerzen.py`**: erzeugt `schrift.js` reproduzierbar aus
der Original-DejaVu-Schrift. So ist nachvollziehbar, welche Zeichenbereiche enthalten sind.

**Änderungen in `pdf.js`:**
- `pdfErstellen(lib, inhalt, unterschriften)` bekommt die Schrift-Werkzeuge mit übergeben (wie heute
  schon `pdf-lib`): `fontkit` und die beiden Schriften. So läuft es in Deno und in den Node-Tests gleich.
- Statt `StandardFonts.Helvetica` wird DejaVu Sans eingebettet (`subset: true`, also nur benutzte Zeichen).
- Die Funktion `text()` ersetzt nur noch Zeichen durch „?“, die **auch DejaVu nicht kennt**
  (z. B. Emoji oder chinesische Zeichen). Ein PDF entsteht also immer, auch bei ungewöhnlichen Eingaben.
- `umbrechen()` trennt ein zu langes Wort hart an der Zeilenbreite und setzt einen Bindestrich ans
  Zeilenende.

**Änderungen in `index.ts`:** importiert zusätzlich `npm:@pdf-lib/fontkit@1.1.1` und `schrift.js` und reicht
beides an `pdfErstellen` weiter. Am Ablauf, an den Schlüsseln und an den Rechten ändert sich nichts.

**Tests (zuerst, sie müssen vorher rot sein):**
- „Ćirić Čačak Đurđević Şahin Işık Doğan“ erscheint genau so im PDF-Text (heute: Fragezeichen).
- Die bestehenden Tests (Umlaute, €, Š ž Œ, Fußzeile, mehrere Seiten) bleiben grün.
- Ein unbekanntes Zeichen (z. B. ein Emoji) führt nicht zum Absturz, sondern zu „?“.
- Ein überlanges Wort im Abschnittstext und in einem Feldwert: Keine Zeile ist breiter als der erlaubte
  Platz, und der ganze Text ist (ohne Bindestriche) vollständig im PDF.
- Das Muster-PDF (`docs/muster/`) wird neu erzeugt, damit die Chefin die neue Schrift sieht.

**Vorher geprüft (Probelauf am 25.11.):** In Node und in Deno erscheinen die Zeichen richtig, normal und fett.
Der kopierte Text stimmt. Der Umbruch langer Wörter funktioniert.

## 6. Veröffentlichen

1. Alle Tests mit `bash tests/lauf.sh` (die Datenbank ist nicht betroffen, die SQL-Tests laufen trotzdem
   einmal zur Sicherheit mit).
2. Unabhängige Prüfung des ganzen Stands.
3. Deploy der Edge Function als **Version 3** (`index.ts`, `ablauf.js`, `pdf.js`, `schrift.js`) mit
   `verify_jwt: true`, erst nach deiner Freigabe.
4. Danach zusammenführen nach `main`. Netlify ist nicht betroffen, weil sich die App nicht ändert.
5. Erster echter Test am iPad mit einem Demo-Namen wie „Ivana Ćirić“.

**Rückweg, falls am iPad etwas nicht stimmt:** Version 2 der Edge Function wieder einspielen (die Dateien
liegen unverändert in Git). Es gehen dabei keine Daten verloren.

## 7. Entschiedene Fragen

1. **Kyrillisch und Griechisch:** Ja (25.11.2026). Rund 150 KB statt 110 KB je Schnitt.
2. **Muster-PDF:** Mansur sieht das neue Muster (DejaVu Sans statt Helvetica) zuerst selbst an,
   bevor es der Chefin gezeigt wird.

**Nachtrag beim Bauen (25.11.2026):** Statt DejaVu Sans wird **DejaVu Sans Condensed** verwendet (gleiche
Schriftfamilie und Lizenz). Die normale DejaVu Sans ist rund 13 % breiter als Helvetica, dadurch rutschten im
Muster-Dienstzettel die Unterschriften auf eine zweite Seite. Condensed ist nur rund 2 % breiter, das Muster
bleibt einseitig wie bisher. `schrift.js` ist damit rund 300 KB groß.
