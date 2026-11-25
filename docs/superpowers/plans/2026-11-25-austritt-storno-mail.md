# Austritt, Storno und Mail-Knöpfe – Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Leitung meldet Austritt oder „nicht angetreten“, das Büro bestätigt, die App führt durch Abmeldung bzw. Storno, und das Büro übermittelt Anmeldungen, Abmeldungen, Stornos und Korrekturen gesammelt je Lohnverrechner über einen Mail-Knopf.

**Aufbau:** Meldungen liegen in einer neuen Tabelle `austritt_meldung` (nur über Funktionen beschreibbar, nie gelöscht). Der Status eines Dienstverhältnisses wird in `app.dv_status(dv)` berechnet, nicht gespeichert. Erst die Bestätigung setzt `dienstverhaeltnis.austritt`. Die Edge Function `mappe` erzeugt zusätzlich die PDFs „Austrittsmeldung“, „Storno-Meldung“ und „Korrektur“. Die App baut den Mail-Link (`mailto:`) und die Dateinamen in einem reinen Modul `app/sammelmail.js`.

**Technik:** Supabase (Postgres, Storage, Edge Function/Deno), `pdf-lib` 1.17.1, reines JavaScript ohne Framework, Node 22 `node:test`, Playwright.

**Konzept:** `docs/superpowers/specs/2026-11-25-austritt-storno-mail-design.md` (freigegeben 25.11.2026, inkl. der vier Vorschläge in § 11).

## Globale Vorgaben

- Alle Vorgaben aus `docs/superpowers/plans/2026-11-22-personalakte.md` und `…-unterschriftsmappe.md` gelten weiter (nur Demo-Daten, keine npm-Pakete in der App, keine Inline-Skripte, nichts löschen, deutsche Meldungen, `apply_migration`, Attributionszeilen, Push mit `git -c push.negotiate=true push`).
- **Migrationsnummern nicht vorab festlegen.** Beim Bauen jeweils die nächste freie Nummer auf dem aktuellen `main` nehmen (andere Projekte spielen gerade 026 ff. ein). Unten heißen sie `M1`, `M2`, `M3`, `M4`.
- **Keine neuen fest einprogrammierten Rollenlisten.** Büro = `app.ist_buero()`. Melden = `rollen_recht.darf_anlegen` + `app.in_reichweite(dv)`. Kein `rolle in ('studioleitung', …)`.
- Datum immer Wiener Zeit: `app.heute_wien()`. Neue Abfragen nutzen nicht `current_date`.
- Keine `delete`/`drop`/`revoke`-Anweisungen, wo es sich vermeiden lässt (Supabase bricht sie manchmal ab). Wo es nicht anders geht (Check-Constraint für Kategorie/Typ erweitern wie in Migration 003, Funktion mit neuer Spalte neu anlegen wie in 021), die Anweisung verwenden und im Ergebnis vermerken, falls Supabase abbricht.
- Status-Werte (genau so, die Startseite filtert danach): `aktiv`, `austritt_gemeldet`, `austritt_bestaetigt`, `abgemeldet`, `nicht_angetreten_gemeldet`, `storno_ausstaendig`, `nicht_angetreten`.
- Austrittsarten (Vorgabe, in Einstellungen änderbar, Schlüssel → Anzeige): `probezeit` Lösung in der Probezeit, `kuendigung_an` Kündigung durch Arbeitnehmer, `kuendigung_ag` Kündigung durch Arbeitgeber, `einvernehmlich` Einvernehmliche Auflösung, `befristung` Ende der Befristung, `entlassung` Entlassung, `vorzeitig` Vorzeitiger Austritt, `sonstiges` Sonstiges.
- Abmeldefrist: `organisation.abmeldefrist_tage int not null default 7`. Frist = letzter Arbeitstag + Abmeldefrist.
- Mail-Adresse Personalbüro: `organisation.buero_email text`, Demo `personal@demo.invalid`.
- Fehlermeldungen (genau so):
  - `Bitte den letzten Arbeitstag angeben.`
  - `Der letzte Arbeitstag darf nicht vor dem Dienstantritt liegen.`
  - `Der letzte Arbeitstag darf höchstens ein Jahr in der Zukunft liegen.`
  - `Bitte die Art des Austritts wählen.`
  - `Bitte einen Grund angeben.`
  - `Für diese Person ist bereits ein Austritt oder „nicht angetreten“ gemeldet.`
  - `„Nicht angetreten“ kann erst ab dem geplanten Dienstantritt gemeldet werden.`
  - `Diese Meldung wurde inzwischen geändert. Bitte die Seite neu laden.`
  - `Das darf nur das Personalbüro.`
  - Reichweite: die vorhandene Meldung `Du bist für dieses Studio nicht zuständig.`
- Mail: Betreff `Staff-Solutions: <Aufzählung>, <TT.MM.JJJJ>` mit Aufzählung wie `3 Anmeldungen, 1 Abmeldung` (Einzahl/Mehrzahl, Reihenfolge Anmeldung, Abmeldung, Storno, Korrektur, nur vorhandene). Text: Anrede `Guten Tag,`, Satz `anbei die folgenden Unterlagen:`, je Fall eine Zeile `- <Art>: <Nachname> <Vorname>, <GmbH>, <Datum>`, ab dem 31. Fall `… und <n> weitere, siehe Anhänge`, Schluss `Mit freundlichen Grüßen`. **Nie** Versicherungsnummer, IBAN, Gehalt oder Geburtsdatum im Text.
- Dateiname: `<JJJJ-MM-TT>_<Lohnverrechner>_<Art>_<Nachname>-<Vorname>.pdf`, Umlaute ausgeschrieben (ä→ae, ß→ss), Leerzeichen → `-`, alles außer `A-Za-z0-9-_` entfernt.
- Die Oberfläche (Tasks 6–8) wird **erst gebaut, wenn das neue Design (Blau/Türkis) auf `main` ist.** Tasks 1–5 können vorher laufen.

## Prüfschwerpunkte (Review Focus)

1. **Leitung und Büro arbeiten gleichzeitig an derselben Meldung** (Büro bestätigt, während die Leitung noch einmal meldet, oder zwei Büro-Benutzer bestätigen) → genau eine gültige Meldung, der zweite bekommt `Diese Meldung wurde inzwischen geändert. Bitte die Seite neu laden.` bzw. `Für diese Person ist bereits …`. Test in Task 2.
2. **Letzter Arbeitstag in der Zukunft** (Kündigung zum Monatsende) → Person bleibt bis inkl. diesem Tag in aktiven Listen, Mappe und offenen Punkten; ab dem Folgetag (Wiener Datum) nicht mehr. Test in Task 2 (mit Datum um 23:30 Wiener Zeit).
3. **„Gesendet?“ mit „Ja“, aber ein Fall wurde in der Zwischenzeit korrigiert** → nur die Dokumente vermerken, die noch offen sind; korrigierte bleiben bzw. kommen als Korrektur neu auf die Liste. Test in Task 3.
4. **Name mit Sonderzeichen oder sehr vielen Fällen in der Sammelmail** (z. B. `Đorđević`, `O'Brien`, 45 Fälle) → Dateiname gültig, Mail-Link unter 1 800 Zeichen, Text gekürzt mit „… und n weitere“. Test in Task 5.
5. **Austritt zurücknehmen nach schon übermittelter Abmeldung** → Status wieder `aktiv`, `austritt` leer, und eine Korrektur steht auf der Übermittlungsliste. Test in Task 3.

---

## Dateien im Überblick

| Datei | Aufgabe |
|---|---|
| `supabase/migrations/<M1>_austritt_grundlage.sql` | Tabelle `austritt_meldung`, Kategorie `storno`, Dokument-Typen, Einstellungen, `app.dv_status`, `app.dv_aktiv` |
| `supabase/migrations/<M2>_austritt_ablauf.sql` | `austritt_melden`, `austritt_bestaetigen`, `austritt_korrigieren`, `austritt_verlauf`; Status in `mitarbeiter_verzeichnis`, `akte_kopf`; aktive Filter in `offene_punkte`, Mappe |
| `supabase/migrations/<M3>_uebermittlung.sql` | Tabelle `sammelversand`, `uebermittlung_offen`, `uebermittlung_vermerken`, neue offene Punkte |
| `supabase/migrations/<M4>_meldung_pdf.sql` | `meldung_inhalt`, `meldung_ablegen` (nur `service_role`) |
| `supabase/tests/15_austritt.sql`, `16_uebermittlung.sql`, `17_meldung_pdf.sql` (14 belegt „Kleinigkeiten“) | DB-Tests |
| `supabase/functions/mappe/pdf.js`, `ablauf.js`, `index.ts` | neue Aktion `meldung` |
| `app/sammelmail.js` | reines Modul: Mail-Link, Dateiname, Kürzen |
| `app/akte_austritt.js` | Melden, Bestätigen, Korrigieren, Verlauf in der Akte |
| `app/uebermittlung.js` | Bereich „An Lohnverrechner übermitteln“ |
| `app/app.js`, `app/api.js`, `app/akte.js`, `app/offene_punkte.js`, `app/einstellungen.js`, `app/index.html`, `app/style.css` | Anbindung |
| `tests/unit/sammelmail.test.mjs`, `tests/unit/mappe_pdf.test.mjs`, `tests/unit/mappe_ablauf.test.mjs`, `tests/ui/austritt.test.js`, `tests/ui/mock.js` | App-Tests |
| `supabase/seed_demo.sql` | zweiter und dritter Demo-Lohnverrechner, je GmbH zugeordnet; `buero_email` |
| `docs/handbuch.md` | neues Kapitel „Austritt und Storno“ |

---

### Task 1: Grundlage in der Datenbank (Tabelle, Status, Einstellungen)

**Files:**
- Create: `supabase/migrations/<M1>_austritt_grundlage.sql`, `supabase/tests/14_austritt.sql`
- Modify: `supabase/seed_demo.sql`

**Interfaces:**
- Produces:
  - Tabelle `public.austritt_meldung(id uuid pk, organisation_id uuid, dienstverhaeltnis_id uuid, art text check in ('austritt','nicht_angetreten'), letzter_arbeitstag date, austrittsart text, notiz text, gemeldet_von uuid, gemeldet_am timestamptz, bestaetigt_von uuid, bestaetigt_am timestamptz, abweichung text, zurueckgenommen boolean default false, korrektur_grund text, ersetzt_durch uuid, ersetzt_am timestamptz)`. Bei `art='austritt'` sind `letzter_arbeitstag` und `austrittsart` Pflicht, bei `nicht_angetreten` ist `notiz` (der Grund) Pflicht. Höchstens eine Zeile je Dienstverhältnis mit `ersetzt_durch is null` (eindeutiger Teilindex). Trigger `app.nur_ueber_funktionen` und `loeschen_verboten` wie bei `dokument`.
  - `dokument.kategorie` erlaubt zusätzlich `storno` (Sichtbarkeit wie `abmeldung`: `app.zusatzstufe('storno') = 'lohnverrechnung'`); `dokument.typ` erlaubt zusätzlich `austrittsmeldung`, `stornomeldung`, `korrekturmeldung`.
  - `dokument.austritt_meldung_id uuid` (Fremdschlüssel, für die erzeugten PDFs).
  - `organisation.abmeldefrist_tage int not null default 7`, `organisation.buero_email text`, Tabelle `public.austrittsart(organisation_id, schluessel, bezeichnung, reihenfolge, aktiv)` mit den Vorgaben aus „Globale Vorgaben“, angelegt in `app.standard_rechte`-Art für jede bestehende Firma.
  - `app.aktuelle_meldung(p_dv uuid) returns public.austritt_meldung` (gültige Zeile oder null; zurückgenommene zählen als keine).
  - `app.dv_status(p_dv uuid) returns text` mit den sieben Status-Werten. Bestätigung (Abmeldung/Storno) = Dokument der Kategorie `abmeldung` bzw. `storno` mit Datei, `ersetzt_durch is null` und Typ **nicht** `austrittsmeldung`/`stornomeldung`/`korrekturmeldung`. `storno_ausstaendig` nur, wenn `app.angemeldet(dv)`.
  - `app.dv_aktiv(p_dv uuid) returns boolean`: wahr bei `aktiv`, `austritt_gemeldet`, `nicht_angetreten_gemeldet`, sowie bei `austritt_bestaetigt`/`abgemeldet`, solange `austritt >= app.heute_wien()`.

- [ ] **Step 1: Tests schreiben** in `14_austritt.sql` (Teil „Grundlage“), mit `testhilfe.mitarbeiter_anlegen` und Zeilen, die als Dienst (`testhilfe.als_dienst()`) eingefügt werden:
  - ohne Meldung → `dv_status = 'aktiv'`, `dv_aktiv = true`
  - gemeldet, nicht bestätigt → `austritt_gemeldet`
  - bestätigt, ohne Bestätigungsdokument → `austritt_bestaetigt`; mit hochgeladener Abmeldung → `abgemeldet`; ein Dokument vom Typ `austrittsmeldung` allein → bleibt `austritt_bestaetigt`
  - nicht angetreten bestätigt, nicht angemeldet → `nicht_angetreten`; angemeldet ohne Storno → `storno_ausstaendig`; mit Storno → `nicht_angetreten`
  - zurückgenommene Meldung → `aktiv`
  - direktes `insert`/`update` als `authenticated` auf `austritt_meldung` → Fehler (`testhilfe.erwarte_fehler`)
  - zweite gültige Zeile für dasselbe Dienstverhältnis → Fehler (Teilindex)
  - `dv_aktiv`: `austritt = heute_wien()` → wahr, `austritt = heute_wien() - 1` → falsch
- [ ] **Step 2:** Test mit `execute_sql` ausführen → schlägt fehl (Funktionen fehlen).
- [ ] **Step 3:** `<M1>` schreiben und mit `apply_migration` einspielen. `seed_demo.sql`: Lohnverrechner `Demo Lohnbüro Nord` (`lohn-nord@demo.invalid`) und `Demo Lohnbüro Holding` (`lohn-holding@demo.invalid`) ergänzen, Holding-GmbH → Holding-Lohnbüro, eine Studio-GmbH → Nord; `buero_email = 'personal@demo.invalid'`.
- [ ] **Step 4:** Test ausführen → grün. Tests 01–13 ebenfalls → grün.
- [ ] **Step 5:** Commit `Austritt: Grundlage (Tabelle, Status, Einstellungen)`.

### Task 2: Melden, Bestätigen, Korrigieren

**Files:**
- Create: `supabase/migrations/<M2>_austritt_ablauf.sql`
- Modify: `supabase/tests/14_austritt.sql` (Teil „Ablauf“)

**Interfaces:**
- Consumes: Task 1.
- Produces (alle `security definer`, `search_path = ''`, `grant execute … to authenticated`):
  - `public.austritt_melden(p_dienstverhaeltnis_id uuid, p_art text, p_letzter_arbeitstag date, p_austrittsart text, p_notiz text, p_gleich_bestaetigen boolean default false) returns uuid`. Recht: `darf_anlegen` und `app.in_reichweite`. `p_gleich_bestaetigen` nur für `app.ist_buero()`. Prüft: Datum ≥ `eintritt`, ≤ heute + 1 Jahr; „nicht angetreten“ nur wenn `heute_wien() >= eintritt`; keine gültige Meldung vorhanden. Sperrt die Zeile des Dienstverhältnisses (`for update`), damit zwei Meldungen nicht gleichzeitig entstehen.
  - `public.austritt_bestaetigen(p_meldung_id uuid, p_letzter_arbeitstag date default null, p_austrittsart text default null) returns uuid`. Nur Büro. Weicht Datum/Art ab, wird eine neue Fassung angelegt (alte `ersetzt_durch`) und `abweichung` = `'Letzter Arbeitstag 30.11.2026 statt 28.11.2026'` bzw. `'Art: … statt …'`. Setzt bei `art='austritt'` `dienstverhaeltnis.austritt = letzter_arbeitstag`; bei `nicht_angetreten` bleibt `austritt` leer. Schon bestätigt oder ersetzt → `Diese Meldung wurde inzwischen geändert. …`.
  - `public.austritt_korrigieren(p_meldung_id uuid, p_grund text, p_letzter_arbeitstag date, p_austrittsart text, p_zuruecknehmen boolean default false) returns uuid`. Nur Büro, Grund Pflicht. Neue bestätigte Fassung (oder zurückgenommene), alte `ersetzt_durch`. Setzt `austritt` neu bzw. auf `null`.
  - `public.austritt_verlauf(p_dienstverhaeltnis_id uuid) returns table(id uuid, art text, letzter_arbeitstag date, austrittsart text, notiz text, gemeldet_von_email text, gemeldet_am timestamptz, bestaetigt_von_email text, bestaetigt_am timestamptz, abweichung text, zurueckgenommen boolean, korrektur_grund text, ersetzt boolean)`. `austrittsart`, `notiz`, `korrektur_grund`, `abweichung` nur mit `app.sieht('personendaten', standort)`, sonst `null`.
  - `public.mitarbeiter_status() returns table(dienstverhaeltnis_id uuid, status text, austritt date)` mit derselben Reichweite wie `mitarbeiter_verzeichnis()`. (Geändert beim Bauen: eine neue Spalte im Verzeichnis hätte `drop function` gebraucht, das Supabase abbricht. Die Startseite nutzt `mitarbeiter_status()`.)
  - `akte_kopf()` zusätzlich `'status'`, `'abmeldung_bis'` (bei `austritt_bestaetigt`: austritt + abmeldefrist_tage), `'meldung_id'`.
  - `offene_punkte()` und `mappe_inhalt()`: Bedingung `(d.austritt is null or d.austritt >= current_date)` ersetzen durch `app.dv_aktiv(d.id)` und Status `nicht_angetreten`/`storno_ausstaendig` ausschließen.

- [ ] **Step 1: Tests schreiben** je Rolle (`testhilfe.benutzer('studioleitung')`, `'regionalleitung'`, `'hr'`, `'verwaltung'`):
  - Studioleitung meldet Austritt im eigenen Studio → ok, Status `austritt_gemeldet`, `austritt` noch `null`
  - Studioleitung in fremdem Studio → `Du bist für dieses Studio nicht zuständig.`
  - Verwaltung (ohne `darf_anlegen`) → Fehler
  - Leitung mit `p_gleich_bestaetigen = true` → `Das darf nur das Personalbüro.`
  - jede Fehlermeldung aus „Globale Vorgaben“ einmal auslösen
  - zweite Meldung → `Für diese Person ist bereits …`
  - HR bestätigt → `austritt` gesetzt, Status `austritt_bestaetigt`; zweites Bestätigen → `Diese Meldung wurde inzwischen geändert. …`
  - HR bestätigt mit anderem Datum → zwei Zeilen im Verlauf, `abweichung` wie oben
  - Büro meldet mit `p_gleich_bestaetigen` → direkt `austritt_bestaetigt`
  - nicht angetreten vor Dienstantritt → Fehler; ab Dienstantritt → ok; nach Bestätigung `austritt` bleibt `null`
  - Korrektur mit Zurücknehmen → `aktiv`, `austritt` `null`, alte Fassungen im Verlauf `ersetzt = true`
  - Verwaltung sieht im Verlauf `notiz = null`, Regionalleitung sieht sie
  - `mitarbeiter_status()` liefert `status`
  - `offene_punkte()` enthält keine Punkte für `nicht_angetreten` und für `austritt = heute_wien() - 1`, wohl aber für `austritt = heute_wien()`
  - Prüfschwerpunkt 2: `heute_wien()` über `set local timezone`/Testhilfe auf 23:30 Wiener Zeit stellen, wie in Test 09
- [ ] **Step 2:** ausführen → rot.
- [ ] **Step 3:** `<M2>` schreiben, einspielen. Vorhandene Funktionen mit `create or replace` neu anlegen, ohne `drop`.
- [ ] **Step 4:** 14 und 01–13 → grün.
- [ ] **Step 5:** Commit `Austritt: melden, bestätigen, korrigieren`.

### Task 3: Übermittlungsliste, Sammelversand, neue offene Punkte

**Files:**
- Create: `supabase/migrations/<M3>_uebermittlung.sql`, `supabase/tests/15_uebermittlung.sql`

**Interfaces:**
- Consumes: Task 1, 2.
- Produces:
  - Tabelle `public.sammelversand(id, organisation_id, lohnverrechner_id, gesendet_am timestamptz, gesendet_von uuid, dokument_ids uuid[])`, nur über Funktionen, Löschen gesperrt.
  - `public.uebermittlung_offen() returns table(lohnverrechner_id uuid, lohnverrechner_name text, lohnverrechner_email text, dienstverhaeltnis_id uuid, vorname text, nachname text, gesellschaft text, art text, dokument_id uuid, datum date)`. Nur Büro (sonst leer). `art` in `anmeldung` (abgeschlossener Dienstzettel, nicht übermittelt), `abmeldung` (Dokument Typ `austrittsmeldung`), `storno` (`stornomeldung`), `korrektur` (`korrekturmeldung`) – jeweils `ersetzt_durch is null and uebermittelt_am is null`. Dazu Zeilen mit `dokument_id = null` für bestätigte Meldungen, deren PDF noch fehlt (App zeigt „PDF erzeugen“). Lohnverrechner über `gesellschaft.lohnverrechner_id`; GmbH ohne Lohnverrechner → `lohnverrechner_id = null`, Name `Kein Lohnverrechner hinterlegt`.
  - `public.uebermittlung_vermerken(p_dokument_ids uuid[]) returns table(sammelversand_id uuid, vermerkt int)`. Nur Büro. Vermerkt nur Dokumente, die noch offen sind (`uebermittelt_am is null and ersetzt_durch is null`), legt einen `sammelversand` je Lohnverrechner an.
  - `offene_punkte()` zusätzlich (nur Büro): `austritt_bestaetigen` „Austritt bestätigen“ / „Nicht angetreten bestätigen“ (Datum = letzter Arbeitstag bzw. eintritt); `abmeldung` „Abmeldung übermitteln bis TT.MM.JJJJ“ (Datum = Frist); `storno` „Storno ausständig“; `abschrift` „Abschrift der Abmeldung aushändigen“ (Abmeldebestätigung ohne `ausgehaendigt_am`). Diese Punkte gelten auch nach dem letzten Arbeitstag (nicht an `dv_aktiv` gebunden).
  - `public.abmeldung_aushaendigen(p_dokument_id uuid, p_art text)` (`ausdruck`/`email`) für die hochgeladene Abmeldebestätigung. (Geändert beim Bauen: eigene Funktion statt `dienstzettel_vermerken` umzubauen.)

- [ ] **Step 1: Tests schreiben:**
  - nach Bestätigung erscheint die Person in `uebermittlung_offen` mit `dokument_id = null`; nach Ablage eines `austrittsmeldung`-Dokuments mit dieser ID
  - Gruppierung: zwei GmbHs mit zwei Lohnverrechnern → zwei verschiedene `lohnverrechner_id`
  - Leitung bekommt leere Liste; `uebermittlung_vermerken` als Leitung → `Das darf nur das Personalbüro.`
  - Vermerken von 3 Dokumenten, eines davon inzwischen ersetzt → `vermerkt = 2` (Prüfschwerpunkt 3)
  - Prüfschwerpunkt 5: Austrittsmeldung übermittelt, dann zurückgenommen → Status `aktiv`, auf der Liste erscheint eine `korrektur` ohne PDF
  - offene Punkte: Frist rechnet mit `abmeldefrist_tage` (auf 10 stellen → Datum verschiebt sich)
  - `abschrift` verschwindet nach `abmeldung_aushaendigen(…, 'ausdruck')`
- [ ] **Step 2:** ausführen → rot.
- [ ] **Step 3:** `<M3>` schreiben, einspielen.
- [ ] **Step 4:** 15, 14, 01–13 → grün.
- [ ] **Step 5:** Commit `Übermittlung an Lohnverrechner: Liste und Sammelversand`.

### Task 4: PDFs Austrittsmeldung, Storno-Meldung, Korrektur (Edge Function)

**Files:**
- Create: `supabase/migrations/<M4>_meldung_pdf.sql`, `supabase/tests/17_meldung_pdf.sql`, `tests/unit/meldung_ablauf.test.mjs`
- Modify: `supabase/functions/mappe/pdf.js`, `ablauf.js`, `index.ts`, `tests/unit/mappe_pdf.test.mjs`, `tests/unit/mappe_ablauf.test.mjs`

**Abstimmung:** Der Thread „Sonderzeichen im PDF“ hat `pdf.js` geändert (Unicode-Schrift). Vor Beginn dessen Stand von `main` holen und darauf aufbauen.

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `public.meldung_inhalt(p_meldung_id uuid) returns jsonb` (Büro und `service_role`): `{ art: 'austrittsmeldung'|'stornomeldung'|'korrekturmeldung', titel, gesellschaft {name, anschrift}, mitarbeiter {nachname, vorname, geburtsdatum, sv_nummer}, eintritt, letzter_arbeitstag, austrittsart_text, grund, bestaetigt_am, bestaetigt_von, vorher (nur Korrektur: { letzter_arbeitstag, austrittsart_text } oder 'Austritt zurückgenommen') }`. Korrektur, wenn die Meldung eine ersetzte Vorgängerin hat, deren PDF schon übermittelt war; sonst Austritts- bzw. Storno-Meldung.
  - `public.meldung_ablegen(p_user uuid, p_meldung_id uuid, p_fassung text, p_pfad text, p_hash text) returns uuid` – nur `service_role`, setzt `request.jwt.claims` lokal wie `mappe_ablegen`, legt `dokument` (Kategorie `abmeldung` bzw. `storno`, Typ wie `art`, `austritt_meldung_id`) an. Gleicher Pfad erneut → dieselbe ID.
  - `pdf.js` bleibt unverändert: `meldung_inhalt` liefert den Inhalt direkt im Format von `pdfErstellen` (Geändert beim Bauen, weniger Code).
  - `ablauf.js`: Aktion `d.aktion === "meldung"` mit `{ meldung_id }`; Ablauf wie `arbeitgeber`: Inhalt holen → PDF → Hash → Speicher `<org>/<dv>/<kategorie>/<uuid>.pdf` → `meldung_ablegen`.
- [ ] **Step 1: Tests:** `16_meldung_pdf.sql` (Rechte, Korrektur-Erkennung, Doppelaufruf, Leitung → Fehler); `mappe_pdf.test.mjs`: Text des PDFs (pdfjs) enthält `Austrittsmeldung`, Name, letzten Arbeitstag `30.11.2026`, Art-Text, bei Korrektur `vorher`-Angaben; `mappe_ablauf.test.mjs`: Aktion `meldung` ruft `meldung_inhalt` und `meldung_ablegen` mit dem richtigen Pfad auf.
- [ ] **Step 2:** ausführen → rot.
- [ ] **Step 3:** umsetzen, Migration einspielen, Edge Function noch **nicht** veröffentlichen (erst in Task 9).
- [ ] **Step 4:** `bash tests/lauf.sh` und 16, 15, 14 → grün.
- [ ] **Step 5:** Commit `Meldungs-PDFs für Abmeldung, Storno, Korrektur`.

### Task 5: Mail-Link und Dateinamen (reines Modul)

**Files:**
- Create: `app/sammelmail.js`, `tests/unit/sammelmail.test.mjs`

**Interfaces:**
- Produces:
  - `export function dateiname({ datum, lohnverrechner, art, nachname, vorname }) → string`
  - `export function betreff(faelle, datum) → string`
  - `export function mailText(faelle, { maxZeilen = 30 } = {}) → string`
  - `export function mailLink({ an, faelle, datum }) → string` (`mailto:` mit `encodeURIComponent`; ist der Link länger als 1 800 Zeichen, wird `maxZeilen` schrittweise verringert)
  - `faelle`: Array aus `uebermittlung_offen()`-Zeilen (`art`, `nachname`, `vorname`, `gesellschaft`, `datum`).
- [ ] **Step 1: Tests:**
  - `dateiname({datum:'2026-11-25', lohnverrechner:'Demo Lohnbüro', art:'anmeldung', nachname:'Muster', vorname:'Max'}) === '2026-11-25_Demo-Lohnbuero_Anmeldung_Muster-Max.pdf'`
  - `Đorđević`, `O'Brien`, `Groß` → nur erlaubte Zeichen (`Dordevic`/`OBrien`/`Gross`)
  - `betreff` mit 3 Anmeldungen und 1 Abmeldung am 25.11.2026 → `Staff-Solutions: 3 Anmeldungen, 1 Abmeldung, 25.11.2026`; 1 Storno → `1 Storno`; 2 Korrekturen → `2 Korrekturen`
  - `mailText` enthält keine Ziffernfolge im Format einer Versicherungsnummer und kein `AT`-IBAN-Muster, auch wenn die Fälle solche Felder mitbringen
  - 45 Fälle → Link ≤ 1 800 Zeichen, Text endet mit `… und 15 weitere, siehe Anhänge` (oder mehr, falls gekürzt) gefolgt von der Grußformel
- [ ] **Step 2:** `node --test tests/unit/sammelmail.test.mjs` → rot.
- [ ] **Step 3:** umsetzen.
- [ ] **Step 4:** → grün.
- [ ] **Step 5:** Commit `Sammelmail: Mail-Link und Dateinamen`.

---

**Ab hier erst, wenn das neue Design auf `main` ist.** Vorher `main` holen und die neuen Klassen/Farben verwenden.

### Task 6: Akte – melden, bestätigen, korrigieren

**Files:**
- Create: `app/akte_austritt.js`
- Modify: `app/akte.js`, `app/api.js`, `app/index.html`, `app/style.css`, `tests/ui/mock.js`
- Test: `tests/ui/austritt.test.js`

**Interfaces:**
- Consumes: Task 2 (RPCs), Task 4 (Edge Function `meldung`).
- Produces: `api.js`: `austrittMelden(dv, art, tag, austrittsart, notiz, gleichBestaetigen)`, `austrittBestaetigen(id, tag, austrittsart)`, `austrittKorrigieren(id, grund, tag, austrittsart, zuruecknehmen)`, `austrittVerlauf(dv)`, `meldungPdf(meldungId)`, `austrittsarten()`.
- Verhalten: Kopf zeigt Status-Etikett (Farben aus dem Design: gelb gemeldet, rot `storno_ausstaendig` und abgelaufene Abmeldefrist, grau abgemeldet/nicht angetreten). Knöpfe „Austritt melden“ / „Nicht angetreten“ nur bei `aktiv` und passendem Recht; „Nicht angetreten“ erst ab Dienstantritt. Büro: „Bestätigen“ (Datum/Art vorbelegt, änderbar), „Korrigieren“ (Grund Pflicht, Häkchen „Austritt zurücknehmen“). Nach dem Bestätigen ruft die App `meldungPdf` auf; schlägt das fehl, Hinweis `Das PDF konnte nicht erstellt werden. Unter „An Lohnverrechner übermitteln“ erneut versuchen.` Verlauf zeigt ersetzte Fassungen durchgestrichen. Optional-Knopf „Rückfrage ans Büro“ (`mailto:` an `buero_email`, nur Name im Betreff), nur wenn `buero_email` gesetzt.
- [ ] **Step 1:** Browser-Test: Leitung meldet Austritt → Etikett „Austritt gemeldet“; Büro bestätigt mit anderem Datum → Verlauf zeigt beide Fassungen; Korrigieren ohne Grund → Meldung `Bitte einen Grund angeben.`; Leitung sieht keinen „Bestätigen“-Knopf.
- [ ] **Step 2:** → rot. **Step 3:** umsetzen. **Step 4:** `bash tests/lauf.sh` → grün. **Step 5:** Commit.

### Task 7: „An Lohnverrechner übermitteln“ und neue offene Punkte

**Files:**
- Create: `app/uebermittlung.js`
- Modify: `app/offene_punkte.js`, `app/api.js`, `app/index.html`, `app/style.css`, `tests/ui/mock.js`, `tests/ui/austritt.test.js`

**Interfaces:**
- Consumes: Task 3 (`uebermittlung_offen`, `uebermittlung_vermerken`, `abmeldung_aushaendigen`), Task 5 (`sammelmail.js`), Speicher-Link wie in `akte_dokumente.js`.
- Verhalten: Bereich je Lohnverrechner mit Häkchen (Voreinstellung alle). Knopf „PDFs speichern und Mail öffnen“: Dateien nacheinander laden (signierter Link → `Blob` → `<a download>`), dann Liste „Gespeichert im Ordner Downloads (am iPad: Dateien-App → Downloads):“ mit jedem Dateinamen, dann `location.href = mailLink(…)`. Danach Dialog „Gesendet?“ mit „Ja, gesendet“ / „Nein, noch nicht“. „Ja“ → `uebermittlung_vermerken`, Liste neu laden, Meldung `<n> Fälle als übermittelt vermerkt.` Zeilen ohne PDF zeigen „PDF erzeugen“. Lohnverrechner ohne E-Mail: Mail-Knopf gesperrt mit `Für diesen Lohnverrechner ist keine E-Mail-Adresse hinterlegt (Einstellungen).` Neue offene Punkte (Task 3) erscheinen mit Link in die Akte; Abmeldefrist abgelaufen → rot.
- [ ] **Step 1:** Browser-Test: zwei Lohnverrechner-Bereiche; „Nein“ ändert nichts; „Ja“ ruft `uebermittlung_vermerken` mit den angehakten IDs auf; Dateinamen werden angezeigt; erzeugter `mailto:` enthält Betreff aus Task 5.
- [ ] **Step 2:** → rot. **Step 3:** umsetzen. **Step 4:** → grün. **Step 5:** Commit.

### Task 8: Mitarbeiterliste-Filter und Einstellungen

**Files:**
- Modify: `app/app.js`, `app/einstellungen.js`, `app/api.js`, `app/index.html`, `tests/ui/austritt.test.js`, `tests/ui/mock.js`
- Migration nur falls nötig für das Speichern der Einstellungen: `einstellungen_austritt_speichern(p_abmeldefrist_tage int, p_buero_email text)`, `austrittsart_speichern(...)`, `lohnverrechner_email_speichern(p_id uuid, p_email text)` – nur Admin (`darf_verwalten`). Kommt dann in `<M4>` oder eine eigene Migration.

- Verhalten Liste: Auswahl „Aktive“ (Voreinstellung: `status` aktiv/gemeldet sowie bestätigt mit `austritt ≥ heute`), „Ein- und Austritte“ (Zeitraum von–bis, Voreinstellung letzte 7 Tage; zeigt Eintritte nach `eintritt` und Austritte nach `austritt`, ohne `nicht_angetreten`/`storno_ausstaendig`), „Alle inkl. ehemalige“. Spalte Status als Etikett.
- Verhalten Einstellungen: Abmeldefrist (1–30 Tage), Mail-Adresse Personalbüro, E-Mail je Lohnverrechner, Austrittsarten (Bezeichnung, Reihenfolge, aktiv; nicht löschbar).
- [ ] **Step 1:** Browser-Test: Verwaltung sieht „Ein- und Austritte“ mit einem Austritt der letzten Woche, ohne Gehaltsspalten; ungültige Mail-Adresse → `Bitte eine gültige E-Mail-Adresse eingeben.`; Abmeldefrist 0 → `Bitte 1 bis 30 Tage eingeben.`
- [ ] **Step 2:** → rot. **Step 3:** umsetzen. **Step 4:** → grün. **Step 5:** Commit.

### Task 9: Handbuch, Gesamtprüfung, Veröffentlichen

- [ ] **Step 1:** `docs/handbuch.md`: Kapitel „Austritt und Storno“ (Ablauf für Leitung und Büro, Status-Tabelle, Sammelmail Schritt für Schritt, wo die PDFs liegen, Hinweis Orientierungsfrist/Urlaubsersatzleistung). Stand-Datum anpassen. `projekt-kontext.md` Abschnitt 6 abhaken.
- [ ] **Step 2:** Gesamttestlauf: alle DB-Tests 01–16 mit `execute_sql`, `bash tests/lauf.sh`, `get_advisors` (nur bekannte Hinweise).
- [ ] **Step 3:** Unabhängiger Prüfer (stärkstes Modell) über den ganzen Zweig mit dem Konzept und diesem Plan; wichtige Funde mit Test beheben.
- [ ] **Step 4:** **Mansur fragen**, dann: Edge Function mit `deploy_edge_function` (`index.ts`, `ablauf.js`, `pdf.js`, `verify_jwt: true`), Zusammenführen nach `main`, `git -c push.negotiate=true push`.
- [ ] **Step 5:** Mansur testet am iPad/PC mit Demo-Daten: melden → bestätigen → Sammelmail → Abmeldung hochladen → Abschrift.
