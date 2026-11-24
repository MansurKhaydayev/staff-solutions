# Unterschriftsmappe – Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Dienstzettel und Onboarding-Unterlagen am iPad unterschreiben lassen, das PDF entsteht auf dem Server, danach unterschreibt die Geschäftsführung, das Büro vermerkt Übermittlung und Aushändigung; dazu Fristregel mit „Dringende Anmeldung“ und „noch nicht angemeldet“.

**Aufbau:** Der Inhalt jedes Dokuments wird einmal in der Datenbank zusammengestellt (`mappe_inhalt`) und daraus sowohl am iPad als Text angezeigt als auch in einer Supabase Edge Function `mappe` als PDF erzeugt. Die Edge Function prüft den Zugang, erzeugt das PDF mit `pdf-lib`, berechnet den Fingerabdruck, legt PDF und Unterschriftsbild ab und trägt alles über Funktionen ein, die nur sie aufrufen darf. Die App bekommt die Seiten „Unterschriftsmappe“ und „Zu unterschreiben“.

**Technik:** Supabase (Postgres, Storage, Edge Functions/Deno), `pdf-lib` 1.17.1 (Deno: `npm:pdf-lib@1.17.1`; lokal global installiert für Tests), reines JavaScript in der App, Node 22 `node:test`, Playwright.

**Konzept:** `docs/superpowers/specs/2026-11-24-unterschriftsmappe-design.md` (freigegeben).

## Globale Vorgaben

- Alle Vorgaben aus `docs/superpowers/plans/2026-11-22-personalakte.md` gelten weiter (Demo-Daten, keine npm-Pakete in der App, keine Inline-Skripte, Rechte über `app.sieht…`, nichts löschen, deutsche Meldungen, `apply_migration`, Attributionszeilen).
- Datum und Uhrzeit für Fristen immer `Europe/Vienna`: `app.jetzt_wien() returns timestamp` = `(now() at time zone 'Europe/Vienna')`.
- Fristregel-Vorgaben: Stichzeit `12:00`, Tage dazwischen vor Stichzeit `0`, nach Stichzeit `1`, gezählt in Kalendertagen. Frühester Dienstantritt = Datum der Übermittlung + 1 + Tage dazwischen.
- Meldung bei Verstoß (genau so): `Zu kurzfristig. Frühester Dienstantritt ist <Wochentag>, <TT.MM.JJJJ>. Bei dringendem Bedarf „Dringende Anmeldung“ wählen.`
- Hinweis bei dringend (genau so): `Erst arbeiten lassen, wenn „angemeldet“ angezeigt wird.`
- Dienstantritt vor heute (Wien) ist im Dienstzettel für alle Rollen gesperrt: `Der Dienstantritt kann nicht in der Vergangenheit liegen.`
- Der geheime Schlüssel (`SUPABASE_SERVICE_ROLE_KEY`) wird nur in der Edge Function aus der Umgebung gelesen, nie in Dateien geschrieben.
- Funktionen, die PDFs und Unterschriften eintragen (`mappe_ablegen`, `arbeitgeber_ablegen`), sind nur für `service_role` ausführbar; sie bekommen die handelnde Person als `p_user` und setzen für ihre Rechteprüfung `request.jwt.claims` lokal auf diese Person.
- Speicherpfade: PDF `<org>/<dv>/vereinbarung/<uuid>.pdf` (Dienstzettel) bzw. `<org>/<dv>/onboarding/<uuid>.pdf`; Unterschriftsbild `<org>/<dv>/unterschrift/<uuid>.png`. Neue Kategorie für Storage-Rechte: `unterschrift` → sichtbar wie `vereinbarung` (Dokumente + Entgelt).
- Unterschriftsbild: PNG, 1 000 bis 300 000 Byte, sonst `Bitte deutlich unterschreiben.` bzw. `Die Unterschrift ist zu groß.`
- PDF: A4, Standardschrift Helvetica (Umlaute über WinAnsi), Fußzeile `Dokument-Nr. <erste 8 Zeichen der Dokument-ID> · Fingerabdruck des Inhalts <erste 12 Zeichen inhalt_hash> · Seite x von y`.
- Bedienung am iPad: Unterschriftsfeld volle Breite, mindestens 180 px hoch; Knöpfe ≥ 44 px.

## Prüfschwerpunkte (Review Focus)

1. **Daten ändern sich zwischen Anzeigen und Unterschreiben** (Büro trägt gleichzeitig eine Änderung ein) → Server lehnt ab mit `Die Daten wurden geändert. Bitte die Mappe neu öffnen.`, keine Unterschrift gespeichert. Test in Task 3.
2. **Doppeltes Tippen auf „Unterschreiben“** → nur ein Dokument und eine Unterschrift; der zweite Aufruf liefert dasselbe Dokument. Test in Task 3.
3. **iPad wird gedreht oder das Fenster ändert die Größe während des Unterschreibens** → Unterschrift bleibt erhalten oder das Feld zeigt deutlich „Bitte erneut unterschreiben“, nie ein abgeschnittenes Bild. Test in Task 5.
4. **Fristgrenze genau um 12:00 und um Mitternacht** → 11:59 und 12:00 gelten als „bis 12:00“, 12:01 als „nach 12:00“; 23:30 Wiener Zeit zählt zum Wiener Datum, nicht zum UTC-Datum. Test in Task 2.
5. **Geschäftsführung unterschreibt einen Dienstzettel, für den gerade „neu unterschreiben lassen“ angefordert wurde** → Ablehnung `Dieser Dienstzettel wird neu erstellt und kann nicht mehr unterschrieben werden.` Test in Task 4.

---

## Dateien im Überblick

| Datei | Aufgabe |
|---|---|
| `supabase/functions/mappe/pdf.js` | PDF aus Inhalt + Unterschriften (reines Modul, `pdf-lib` wird übergeben) |
| `supabase/functions/mappe/ablauf.js` | Ablauf einer Anfrage (reines Modul, Abhängigkeiten werden übergeben) |
| `supabase/functions/mappe/index.ts` | Deno-Einstieg: verbindet `ablauf.js` mit Supabase (fetch) |
| `supabase/functions/mappe/muster.mjs` | erzeugt das Muster-PDF mit Demo-Daten |
| `docs/muster/dienstzettel-muster.pdf`, `docs/muster/onboarding-muster.pdf` | Muster zum Vorzeigen |
| `supabase/migrations/20261124000020_mappe_einstellungen.sql` | Fristregel, Textbausteine, Onboarding-Texte, Recht AG-Unterschrift |
| `…0021_dienstzettel_frist.sql` | Dienstzettel mit Fristregel/dringend, „angemeldet“ |
| `…0022_mappe_mitarbeiter.sql` | `mappe_inhalt`, `mappe_ablegen`, Spalten an `dokument`/`unterschrift` |
| `…0023_mappe_arbeitgeber.sql` | `arbeitgeber_offen`, `arbeitgeber_inhalt`, `arbeitgeber_ablegen`, Büro-Aktionen, offene Punkte |
| `supabase/tests/09…12_*.sql` | DB-Tests je Aufgabe |
| `tests/unit/mappe_pdf.test.mjs`, `tests/unit/mappe_ablauf.test.mjs`, `tests/unit/frist.test.mjs` | Einheitstests |
| `app/frist.js` | Fristregel im Formular (gleiche Regel wie DB) |
| `app/unterschrift.js` | Unterschriftsfeld (Zeichnen mit Finger/Stift, PNG, Leer-Prüfung) |
| `app/mappe.js` | Seite `#mappe/<dv>` |
| `app/arbeitgeber.js` | Seite `#unterschreiben` (Liste „Zu unterschreiben“) |
| `app/app.js`, `app/index.html`, `app/style.css`, `app/api.js`, `app/einstellungen.js`, `app/akte.js`, `app/akte_dokumente.js` | Anbindung |
| `tests/ui/mappe.test.js` | Browser-Test Mappe, Arbeitgeber, Dienstzettel-Frist |

**So laufen Tests:** wie im Personalakte-Plan. Zusätzlich: `tests/lauf.sh` führt `tests/ui/*.test.js` bereits aus. Die Edge Function kann hier nicht gestartet werden (kein Deno, keine Verbindung zu Supabase aus der Shell): `pdf.js` und `ablauf.js` werden mit Node getestet, `index.ts` bleibt dünn und wird nach dem Deploy vom Auftraggeber in der App ausprobiert.

---

### Task 1: PDF-Layout und Muster-PDF

**Dateien:** Neu: `supabase/functions/mappe/pdf.js`, `supabase/functions/mappe/muster.mjs`, `tests/unit/mappe_pdf.test.mjs`, `docs/muster/*.pdf`

**Schnittstellen:**
- Liefert: `export async function pdfErstellen(lib, inhalt, unterschriften) -> Uint8Array`
  - `lib` = das `pdf-lib`-Modul.
  - `inhalt` = `{ art: "dienstzettel"|"onboarding", dokument_nr: string, inhalt_hash: string, kopf: { firma, adresse }, titel, untertitel?, felder: [[bezeichnung, wert]], abschnitte: [{ titel, text }], unterschrift_zeilen: [{ rolle: "mitarbeiter"|"arbeitgeber", beschriftung, ort_datum? }] }`
  - `unterschriften` = `{ mitarbeiter?: { png: Uint8Array, ort, datum }, arbeitgeber?: { png, ort, datum } }`.
- `inhalt` hat genau diese Form überall (DB-Funktion `mappe_inhalt` in Task 3 liefert sie je Dokument).

- [ ] **Schritt 1: Test** `mappe_pdf.test.mjs` (Text mit `pdfjs-dist` aus dem globalen `node_modules` lesen):
  - Dienstzettel mit Demo-Inhalt → PDF beginnt mit `%PDF`, Text enthält „DIENSTZETTEL“, „Frau Anna Berger“, „€ 1.300,00“, „Größe“ (Umlaut-Probe in einem Abschnitt), „Dokument-Nr. 1a2b3c4d“, „Seite 1 von“.
  - Langer Abschnitt (40 Absätze) → mehr als eine Seite, jede Seite hat die Fußzeile.
  - Mit Mitarbeiter-Unterschrift (kleines Test-PNG) → `ort_datum` „Leoben, 24.11.2026“ erscheint; ohne Arbeitgeber-Unterschrift steht unter der Arbeitgeber-Zeile „noch nicht unterschrieben“.
  - Onboarding-Inhalt ohne Arbeitgeber-Zeile → nur eine Unterschriftszeile.
- [ ] **Schritt 2:** `NODE_PATH=$(npm root -g) node --test tests/unit/mappe_pdf.test.mjs` → FAIL.
- [ ] **Schritt 3:** `pdf.js` umsetzen: Zeilenumbruch nach Textbreite (`font.widthOfTextAtSize`), Seitenwechsel, zweispaltige Unterschriftszeilen am Ende (gemeinsam auf eine Seite, sonst neue Seite), PNG über `embedPng`, max. 60 × 180 pt.
- [ ] **Schritt 4:** PASS. `tests/lauf.sh` um `NODE_PATH` für Einheitstests ergänzen, falls nötig.
- [ ] **Schritt 5:** `muster.mjs` erzeugt mit Demo-Daten (DemoFit Steiermark GmbH, Anna Berger, Demo-Textbausteine) `docs/muster/dienstzettel-muster.pdf` (mit beiden Demo-Unterschriften) und `docs/muster/onboarding-muster.pdf` (Bildaufnahme). Seiten als Bild ansehen (pdf → png mit `pdftoppm`, falls vorhanden, sonst pypdf-Text prüfen).
- [ ] **Schritt 6: Commit**, Muster-PDF dem Auftraggeber schicken (für die Chefin) – Bau läuft weiter.

### Task 2: Einstellungen, Texte, Fristregel in der Datenbank

**Dateien:** Neu: `…0020_mappe_einstellungen.sql`, `supabase/tests/09_frist.sql`, `app/frist.js`, `tests/unit/frist.test.mjs`. Ändern: `supabase/seed_demo.sql`

**Schnittstellen:**
- `organisation` + `anmeldung_stichzeit time not null default '12:00'`, `tage_dazwischen_vor int not null default 0`, `tage_dazwischen_nach int not null default 1` (je 0–7).
- Tabelle `textbaustein (id, organisation_id, gesellschaft_id null, schluessel text, titel text, text text, reihenfolge int, aktiv bool)`; eindeutig `(organisation_id, coalesce(gesellschaft_id, '0…0'), schluessel)`; lesen: Büro; ändern: Büro; kein Löschen. Demo-Schlüssel: `kuendigung`, `urlaub`, `entgelt_faelligkeit`, `mitarbeitervorsorge`, `sozialversicherung`, `arbeitszeit_lage`.
- `onboarding_unterlage` + `text text not null default ''` (Demo-Texte für b1–b4 im Seed, ausdrücklich als Demo gekennzeichnet).
- `rollen_recht` + `darf_arbeitgeber_unterschreiben boolean not null default false`; true für `admin`, `geschaeftsfuehrung` (auch in `app.standard_rechte`).
- `app.jetzt_wien() returns timestamp`, `app.heute_wien() returns date`.
- `app.fruehester_dienstantritt(p_org uuid, p_zeitpunkt timestamp) returns date` (Zeitpunkt in Wiener Ortszeit).
- `app.frist_meldung(p_tag date) returns text` (Meldung aus den Globalen Vorgaben, Wochentag deutsch).
- JS `app/frist.js`: `fruehesterDienstantritt(jetzt: Date, regeln) -> "YYYY-MM-DD"` (Wiener Zeit über `Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna" })`), `fristMeldung(iso) -> string`.

- [ ] **Schritt 1: Einheitstest** `frist.test.mjs`: Fr 18:00 Wien → So; Mi 11:59 → Do; Mi 12:00 → Do; Mi 12:01 → Fr; 23:30 Wien am 30.11. (= 22:30 UTC) → 2.12.; Meldung „Zu kurzfristig. Frühester Dienstantritt ist Sonntag, 29.11.2026. …“. FAIL → umsetzen → PASS.
- [ ] **Schritt 2: DB-Test** `09_frist.sql` mit denselben Fällen gegen `app.fruehester_dienstantritt` und `app.frist_meldung`; Einstellungen geändert (Stichzeit 10:00, nach 2) wirken; Textbaustein als Studioleitung nicht lesbar; `darf_arbeitgeber_unterschreiben` Vorgaben stimmen. FAIL → Migration 020 + Seed (per `execute_sql` auf die Demo-Firma) → PASS.
- [ ] **Schritt 3: Commit.**

### Task 3: Dienstzettel mit Fristregel, „angemeldet“, Mitarbeiter-Unterschrift in der Datenbank

**Dateien:** Neu: `…0021_dienstzettel_frist.sql`, `…0022_mappe_mitarbeiter.sql`, `supabase/tests/10_dienstzettel_frist.sql`, `supabase/tests/11_mappe.sql`. Ändern: `supabase/tests/_hilfen.sql` (`mitarbeiter_anlegen` übergibt `p_dringend_grund => 'Test'`, damit Dienstantritt heute möglich bleibt; neu `testhilfe.als_dienst()` = Rolle `service_role`).

**Schnittstellen:**
- `dienstverhaeltnis` + `dringend_grund text`, `dringend_von uuid`, `dringend_am timestamptz`.
- `public.dienstzettel_erfassen(…, p_dringend_grund text default null)` – alte Signatur wird ersetzt (drop + create, Rechte neu vergeben). Prüft: Dienstantritt ≥ `app.heute_wien()`; Dienstantritt ≥ `app.fruehester_dienstantritt(org, app.jetzt_wien())`, sonst Meldung, außer `p_dringend_grund` ist gesetzt.
- `app.angemeldet(p_dv uuid) returns boolean` = Dokument Kategorie `anmeldung` mit Datei, nicht ersetzt. `akte_kopf` + `angemeldet`, `dringend_grund` (immer, nicht vertraulich); `mitarbeiter_verzeichnis` + Spalte `angemeldet boolean`.
- `dokument` + `inhalt jsonb`, `inhalt_hash text`, `papier boolean not null default false`, `neu_angefordert_am timestamptz`, `neu_angefordert_grund text`, `uebermittelt_am timestamptz`, `uebermittelt_von uuid`, `ausgehaendigt_am timestamptz`, `ausgehaendigt_art text check in ('ausdruck','email')`. `dokument_schuetzen` schützt zusätzlich `inhalt`, `inhalt_hash` nach dem ersten Setzen.
- `unterschrift` + `datei_pfad text`, `ort text`, `datei_hash` = SHA-256 des PNG.
- `public.mappe_inhalt(p_dienstverhaeltnis_id uuid) returns jsonb`:
  `{ dienstverhaeltnis_id, name, frist: { fruehester, verletzt: bool, dringend_grund }, schritte: [ { art: "dienstzettel"|"onboarding", unterlage_id?, status: "offen"|"unterschrieben"|"abgelehnt"|"abgeschlossen", dokument_id?, fassung: text, inhalt: <Form aus Task 1, ohne dokument_nr/inhalt_hash> } ] }`.
  Rechte: `app.in_reichweite` und (Büro oder Leitung mit `app.sieht('dokumente', standort)`). Vollständiger Inhalt nur für Schritte mit Status `offen`; für erledigte Schritte nur `art`, `status`, `dokument_id`. `fassung` = SHA-256 (hex) des Inhalts als Text. Dienstzettel-Inhalt: Arbeitgeber (GmbH, Adresse), Arbeitnehmer (Anrede, Name, Geburtsdatum, Adresse), Beginn, Probezeit, Befristung, Arbeitsort (`vertragsbezeichnung`), Tätigkeit (Funktion), Arbeitszeit (aktueller Stand), Entgelt (brutto, sonst netto mit „Brutto wird vom Lohnverrechner ermittelt“), Leiterzulage falls vorhanden, Sonderzahlungen, dann Textbausteine (GmbH-eigene vor Firmen-Vorgabe, je Schlüssel einer), Unterschriftszeilen Arbeitnehmer + Arbeitgeber. Onboarding-Inhalt: Titel = Bezeichnung, Abschnitt = `text`, Felder Name/Arbeitsort/Beginn, eine Unterschriftszeile.
- `public.mappe_ablegen(p_user uuid, p_dienstverhaeltnis_id uuid, p_art text, p_unterlage_id uuid, p_fassung text, p_ergebnis text, p_pdf_pfad text, p_pdf_hash text, p_png_pfad text, p_png_hash text, p_inhalt jsonb, p_dringend_grund text default null) returns uuid` – nur `service_role`. Setzt Claims auf `p_user`, rechnet `mappe_inhalt` neu, vergleicht `p_fassung` (sonst Meldung Prüfschwerpunkt 1), prüft Frist zum jetzigen Zeitpunkt (Dienstzettel, nur erste Fassung; bei Verstoß ohne `p_dringend_grund` Fehler mit Präfix `FRIST:` + Meldung), prüft Speicherobjekte (wie `dokument_ablegen`). Legt an: Dokument (Dienstzettel: `typ dienstzettel`, `kategorie vereinbarung`, `status unterschrieben`; Onboarding: `kategorie onboarding`, `onboarding_ergebnis`, `status abgeschlossen|abgelehnt`), `inhalt`, `inhalt_hash = p_fassung`, Unterschrift (`rolle mitarbeiter`, Name, Ort = Arbeitsort-Ort, PNG) außer bei Ablehnung; frühere Dienstzettel-Fassung (`neu_angefordert_am` gesetzt) bekommt `ersetzt_durch`; dringend-Felder am Dienstverhältnis; `app.onboarding_nach_ablage`. Gleiche `(dv, art, unterlage, fassung)` ein zweites Mal → liefert dasselbe Dokument (Prüfschwerpunkt 2).

- [ ] **Schritt 1: DB-Test** `10_dienstzettel_frist.sql`: Dienstantritt gestern → „Vergangenheit“; Dienstantritt vor frühestem Tag ohne Grund → Frist-Meldung; mit Grund → angelegt, `dringend_*` gesetzt; Verzeichnis/akte_kopf zeigen `angemeldet = false`, nach Ablage einer Anmeldung-Datei `true`; Tests 01–08 bleiben grün (Hilfe mit dringend).
- [ ] **Schritt 2:** FAIL → Migration 021 → PASS (inkl. 01–08).
- [ ] **Schritt 3: DB-Test** `11_mappe.sql`:
  - Studioleitung (zugeordnet) bekommt für neuen Mitarbeiter 1 Dienstzettel + 4 Onboarding-Schritte, alle `offen`, Dienstzettel-Inhalt enthält Entgelt; Studioleitung fremdes Studio → Keine Berechtigung; Buchhaltung → Keine Berechtigung.
  - `mappe_ablegen` als `authenticated` → permission denied; als `service_role` mit `p_user` = Studioleitung und korrekter Fassung → Dokument `unterschrieben`, Unterschrift vorhanden; danach `mappe_inhalt` zeigt Dienstzettel `unterschrieben` ohne Inhalt; Studioleitung sieht das Dokument nicht mehr in `dokument` (Kategorie vereinbarung).
  - Zweiter gleicher Aufruf → dieselbe ID (PS 2). Falsche Fassung → „Die Daten wurden geändert“ (PS 1). Fassung nach `stammdaten_aendern` passt nicht mehr.
  - Onboarding abgelehnt (Pflicht) → Klärung offen, kein Unterschrift-Eintrag.
  - Frist verletzt bei Ablage ohne Grund → Fehler beginnt mit `FRIST:`; mit Grund → ok.
- [ ] **Schritt 4:** FAIL → Migration 022 → PASS (01–11).
- [ ] **Schritt 5: Commit.**

### Task 4: Arbeitgeber-Unterschrift und Büro-Aktionen in der Datenbank

**Dateien:** Neu: `…0023_mappe_arbeitgeber.sql`, `supabase/tests/12_arbeitgeber.sql`

**Schnittstellen:**
- `public.arbeitgeber_offen() returns table (dokument_id, dienstverhaeltnis_id, vorname, nachname, arbeitsort, eintritt date, unterschrieben_am timestamptz, dringend_grund text, pdf_pfad text)` – nur mit `darf_arbeitgeber_unterschreiben`; Dienstzettel `status unterschrieben`, nicht ersetzt, nicht neu angefordert; Reihenfolge: dringend zuerst, dann Dienstantritt.
- `public.arbeitgeber_inhalt(p_dokument_id uuid) returns jsonb` = `{ fassung: inhalt_hash, inhalt, mitarbeiter: { png_pfad, ort, datum } }` – gleiche Rechte.
- `public.arbeitgeber_ablegen(p_user uuid, p_dokument_id uuid, p_fassung text, p_pdf_pfad text, p_pdf_hash text, p_png_pfad text, p_png_hash text) returns uuid` – nur `service_role`; neues Dokument (`status abgeschlossen`, gleicher `inhalt`/`inhalt_hash`), altes bekommt `ersetzt_durch`; Unterschriften beider Rollen zeigen auf das neue Dokument (Mitarbeiter-Unterschrift wird als neue Zeile mit gleichem Bild/Hash/Zeitpunkt-Verweis kopiert – Originalzeile bleibt am alten Dokument). Neu angefordert → Meldung PS 5.
- `public.dienstzettel_neu_anfordern(p_dokument_id uuid, p_grund text) returns void` – Büro/GF; setzt `neu_angefordert_*`; vor AG-Unterschrift zusätzlich `status abgelehnt`.
- `public.dienstzettel_vermerken(p_dokument_id uuid, p_was text, p_art text default null) returns void` – Büro; `p_was` ∈ `uebermittelt|ausgehaendigt`; nur für `abgeschlossen`.
- `public.dienstzettel_papier(p_pfad text, p_hash text, p_dienstverhaeltnis_id uuid) returns uuid` – Büro; wie `dokument_ablegen` (Kategorie vereinbarung), `typ dienstzettel`, `papier true`, `status abgeschlossen`.
- `offene_punkte()` + Arten `dienstzettel` („Dienstzettel unterschreiben lassen“ bzw. „… neu unterschreiben lassen“; Stufe dokumente), `arbeitgeber` („Arbeitgeber-Unterschrift fehlt“; nur für Rollen mit AG-Recht), `uebermittlung` („Dienstzettel an Lohnverrechner übermitteln“; Büro), `dringend` („Dringende Anmeldung: <Grund>“, Büro, solange nicht angemeldet).

- [ ] **Schritt 1: DB-Test** `12_arbeitgeber.sql`: HR sieht `arbeitgeber_offen` nicht (kein Recht) → Fehler; GF sieht den Dienstzettel, dringend zuerst; `arbeitgeber_ablegen` als service_role mit GF → neues Dokument `abgeschlossen`, altes ersetzt, zwei Unterschriften am neuen; mit HR als `p_user` → Keine Berechtigung; nach `dienstzettel_neu_anfordern` → PS 5; `dienstzettel_vermerken` vor Abschluss → Fehler, danach gesetzt; Papier-Dienstzettel → `papier true`, zählt in `mappe_inhalt` als erledigt; offene Punkte enthalten die neuen Arten je Rolle richtig.
- [ ] **Schritt 2:** FAIL → Migration 023 → PASS (01–12). `get_advisors(security)`.
- [ ] **Schritt 3: Commit.**

### Task 5: Edge Function `mappe`

**Dateien:** Neu: `supabase/functions/mappe/ablauf.js`, `supabase/functions/mappe/index.ts`, `tests/unit/mappe_ablauf.test.mjs`

**Schnittstellen:**
- Anfrage `POST /functions/v1/mappe` mit `Authorization: Bearer <Zugang>`, Körper JSON:
  - `{ aktion: "mitarbeiter", dienstverhaeltnis_id, art, unterlage_id?, fassung, ergebnis: "unterschrieben"|"abgelehnt", png_base64?, dringend_grund? }`
  - `{ aktion: "arbeitgeber", dokument_id, fassung, png_base64 }`
  - Antwort `200 { dokument_id }`; Fehler `400 { meldung, frist?: true }` (frist = Meldung begann mit `FRIST:`, Präfix entfernt).
- `ablauf.js`: `export async function bearbeiten(anfrage, abh) -> { status, body }`; `abh = { nutzer(token) -> {id}|null, rpcAlsNutzer(token, name, params), rpcAlsDienst(name, params), hochladen(pfad, bytes, typ), laden(pfad) -> Uint8Array, sha256(bytes) -> hex, pdfLib, uuid() }`. Ablauf Mitarbeiter: Nutzer prüfen → `mappe_inhalt` als Nutzer → Schritt mit `art/unterlage_id` suchen, `fassung` vergleichen → PNG prüfen (Größe) → PDF (`pdfErstellen`, dokument_nr = Vorschau aus neuer uuid) → hochladen PDF + PNG → `mappe_ablegen` als Dienst. Ablehnung: kein PNG, PDF ohne Unterschrift mit Vermerk „abgelehnt am …“.
- `index.ts`: `Deno.serve`, CORS für die App-Adresse und `localhost`, liest `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` aus `Deno.env`, setzt `abh` mit `fetch` um (PostgREST `/rest/v1/rpc/...`, Storage `/storage/v1/object/personalakte/...`, Auth `/auth/v1/user`), `crypto.subtle` für SHA-256, `import * as pdfLib from "npm:pdf-lib@1.17.1"`.

- [ ] **Schritt 1: Einheitstest** `mappe_ablauf.test.mjs` mit Fakes: ohne Token → 401; falsche Fassung → 400 „Die Daten wurden geändert“; PNG 500 Byte → 400 „Bitte deutlich unterschreiben.“; Erfolg → genau zwei Uploads (PDF unter `vereinbarung/…pdf`, PNG unter `unterschrift/…png`) und `mappe_ablegen` mit `p_user`, `p_pdf_hash` = SHA-256 des hochgeladenen PDF; Fehler `FRIST: …` aus der DB → 400 mit `frist: true`; Ablehnung Onboarding → nur PDF-Upload, `p_ergebnis abgelehnt`; Arbeitgeber → lädt Mitarbeiter-PNG, PDF mit zwei Unterschriften, `arbeitgeber_ablegen`.
- [ ] **Schritt 2:** FAIL → umsetzen → PASS.
- [ ] **Schritt 3:** Storage-Regel ergänzen: Kategorie `unterschrift` in `app.zusatzstufe` → `entgelt` (Migration 023 nachziehen oder eigene kleine Migration 024).
- [ ] **Schritt 4:** Deploy mit `deploy_edge_function` (Name `mappe`, Dateien `index.ts`, `ablauf.js`, `pdf.js`, `verify_jwt: true`). `get_edge_function` prüfen. Danach `get_logs`/`query_logs` nach dem ersten Aufruf.
- [ ] **Schritt 5: Commit.**

### Task 6: Unterschriftsfeld und Seite „Unterschriftsmappe“

**Dateien:** Neu: `app/unterschrift.js`, `app/mappe.js`, `tests/ui/mappe.test.js`. Ändern: `app/index.html` (`#seite-mappe`), `app/app.js` (Route `#mappe/<dv>`), `app/api.js` (`mappe(aktion, daten)`), `app/style.css`

**Schnittstellen:**
- `unterschriftsFeld(ziel: HTMLElement) -> { leer(): boolean, png(): Promise<Blob>, loeschen(): void }` – Pointer Events (Finger, Stift, Maus), `touch-action: none`, Linienbreite 2,5 px, Auflösung nach `devicePixelRatio`; „leer“ = weniger als 30 gezeichnete Punkte oder Ausdehnung < 40 × 15 px. Bei Größenänderung: Feld leeren und „Bitte erneut unterschreiben“ anzeigen (PS 3).
- `api.mappe(aktion, daten) -> Promise<object>` – POST an `/functions/v1/mappe`, wirft `ApiFehler(meldung)` mit `fehler.frist = true` bei Fristfehler.
- `mappeZeigen(stand, dvId) -> Promise<void>`: lädt `mappe_inhalt`, zeigt Fortschritt („Schritt 2 von 5“), den ersten offenen Schritt: Kopf, Felder, Abschnitte, Kästchen „Ich habe den Text gelesen“, Unterschriftsfeld, Knöpfe „Unterschreiben“, bei Onboarding „Lehnt ab“, „Später fortsetzen“. Fristfehler → Feld „Grund für dringende Anmeldung“ + Hinweistext, erneut senden. Nach dem letzten Schritt: „Fertig. Alle Unterlagen sind abgelegt.“ und Link zur Akte.

- [ ] **Schritt 1: Browser-Test** `mappe.test.js` (Mock: `mappe_inhalt` mit 1 Dienstzettel + 2 Onboarding, Route `/functions/v1/mappe`): „Unterschreiben“ ohne Häkchen → Meldung; ohne Zeichnung → „Bitte unterschreiben.“; Zeichnen per `page.mouse` → Anfrage mit `aktion mitarbeiter`, `fassung`, `png_base64` (beginnt mit PNG-Signatur); Doppelklick auf „Unterschreiben“ → nur eine Anfrage; Fristfehler-Antwort → Grund-Feld erscheint, zweite Anfrage mit `dringend_grund`; Onboarding „Lehnt ab“ → Anfrage ohne PNG mit `ergebnis abgelehnt`; Fenstergröße ändern nach Zeichnen → Feld leer + Hinweis; Ende → „Fertig“; iPad-Bildschirmfoto 1024×768 quer und 768×1024 hoch; keine JS-Fehler.
- [ ] **Schritt 2:** FAIL → umsetzen → PASS.
- [ ] **Schritt 3: Commit.**

### Task 7: Dienstzettel-Formular, „angemeldet“, Aufruf der Mappe

**Dateien:** Ändern: `app/app.js`, `app/index.html`, `app/pruefungen.js`, `app/akte.js`, `tests/ui/mappe.test.js`, `tests/unit/pruefungen.test.mjs`

**Schnittstellen:**
- `dienstzettelPruefen` meldet `eintritt` „Der Dienstantritt kann nicht in der Vergangenheit liegen.“ und – ohne Häkchen „Dringende Anmeldung“ – die Frist-Meldung (`fristMeldung(fruehesterDienstantritt(new Date(), stand.organisation))`). Neues Formularfeld `dringend` (Kästchen) + `dringend_grund` (Pflicht, wenn angekreuzt); RPC bekommt `p_dringend_grund`.
- Nach dem Speichern: Knopf „Unterschriftsmappe öffnen“ → `#mappe/<dv>`.
- Liste und Akte: Merkmal „noch nicht angemeldet“ (rot) aus `angemeldet`; Akte-Hinweis „Dringende Anmeldung: <Grund>. Erst arbeiten lassen, wenn „angemeldet“ angezeigt wird.“ solange nicht angemeldet; Akte-Knopf „Unterschriftsmappe“ für Büro und Leitungen mit Dokumente-Recht.

- [ ] **Schritt 1: Tests** (Einheit: Vergangenheit, Frist, dringend ohne Grund; Browser: Formular zeigt Frist-Meldung, Häkchen + Grund → RPC mit `p_dringend_grund`, danach Knopf zur Mappe; Merkmal in Liste). FAIL → umsetzen → PASS.
- [ ] **Schritt 2: Commit.**

### Task 8: „Zu unterschreiben“ und Büro-Aktionen in der App

**Dateien:** Neu: `app/arbeitgeber.js`. Ändern: `app/index.html` (`#seite-unterschreiben`, Navigation „Zu unterschreiben“ nur mit `darf_arbeitgeber_unterschreiben`), `app/app.js`, `app/akte_dokumente.js`, `tests/ui/mappe.test.js`

**Schnittstellen:**
- `arbeitgeberZeigen(stand) -> Promise<void>`: Liste aus `arbeitgeber_offen` (dringend rot oben, „Dienstantritt TT.MM.“), je Eintrag „Ansehen“ (signierter Link) und „Unterschreiben“ (Unterschriftsfeld, Häkchen „Ich habe den Dienstzettel geprüft“) → `api.mappe("arbeitgeber", …)`; leer → „Nichts zu unterschreiben.“
- Dokumente-Reiter, bei Dienstzettel-Dokumenten (Büro): „An Lohnverrechner übermittelt“, „Ausgehändigt (Ausdruck/E-Mail)“, „Neu unterschreiben lassen“ (Grund Pflicht), Upload-Kategorie „Dienstzettel (Papier)“ → `dienstzettel_papier`. Anzeige „Papier (Scan)“, „übermittelt am“, „ausgehändigt am“.

- [ ] **Schritt 1: Browser-Test**: Navigation nur für GF/Admin; Liste dringend zuerst; Unterschreiben sendet `aktion arbeitgeber` mit `dokument_id`, `fassung`; Büro-Knöpfe senden die richtigen RPCs; „Neu unterschreiben lassen“ ohne Grund → nicht gesendet. FAIL → umsetzen → PASS.
- [ ] **Schritt 2: Commit.**

### Task 9: Einstellungen

**Dateien:** Ändern: `app/einstellungen.js`, `app/index.html`, `tests/ui/mappe.test.js`

- Regeln-Formular + Stichzeit (`time`), Tage dazwischen vor/nach (0–7).
- Abschnitt „Textbausteine für den Dienstzettel“: je Schlüssel Titel + Text (Textfeld), „für alle GmbHs“ oder je GmbH überschreiben; Speichern per `api.aendern`/`api.anlegen`; kein Löschen, nur „aktiv“.
- Onboarding-Unterlagen: Spalte „Text“ (aufklappbares Textfeld).
- Rechte-Tabelle: Spalte „Arbeitgeber-Unterschrift“.

- [ ] **Schritt 1: Browser-Test** je Abschnitt (PATCH/POST mit den richtigen Feldern). FAIL → umsetzen → PASS.
- [ ] **Schritt 2: Commit.**

### Task 10: Handbuch, Gesamtprüfung, Veröffentlichen

- [ ] Handbuch: Abschnitt „Unterschriftsmappe“ (Ablauf, Fristregel und dringend, Zu unterschreiben, übermittelt/ausgehändigt, neu unterschreiben lassen, Papier-Notlösung, Edge Function in einfachen Worten, Muster-PDF), Begriffe (Edge Function, einfache elektronische Signatur).
- [ ] DB-Tests 01–12, `tests/lauf.sh`, `get_advisors` → grün; Gesamtprüfung durch frischen Prüfer; Korrekturen mit Tests; zusammenführen und pushen.
- [ ] Dem Auftraggeber eine Anleitung zum Ausprobieren am iPad geben (Demo-Mitarbeiter anlegen, Mappe durchgehen, als Chefin unterschreiben).
