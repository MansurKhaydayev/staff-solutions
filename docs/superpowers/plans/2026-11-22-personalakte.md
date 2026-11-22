# Personalakte – Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Eine Personalakte je Dienstverhältnis mit Verlauf der Stundenanpassungen, Stammdatenänderungen mit Nachweis, Dokumentenablage, Onboarding-Checkliste und der Liste „Wem fehlt was“.

**Aufbau:** Die Datenbank (Supabase/Postgres) ist die einzige Quelle der Wahrheit und prüft alles selbst: neue Tabellen mit Zugriffsregeln, `security definer`-Funktionen für jede schreibende Aktion, Dateien in einem privaten Storage-Bucket. Die Web-App (reines HTML/CSS/ES-Module) bekommt eine Akte-Seite `#akte/<dv-id>` mit Reitern und eine Seite „Offene Punkte“.

**Technik:** Supabase (Postgres 15, PostgREST, Storage, Auth), reines JavaScript ohne Bibliotheken, Node 22 (`node:test`) für Einheitstests, Playwright (global installiert) für Browser-Tests mit simulierten Antworten.

**Konzept:** `docs/superpowers/specs/2026-11-22-personalakte-design.md` (freigegeben). Wer baut, liest beides.

## Globale Vorgaben

- Nur erfundene Demo-Daten; nie echte Mitarbeiterdaten committen; `privat/` bleibt außerhalb des Repos; kein `service_role`-Schlüssel im Code.
- Keine npm-Pakete; keine Inline-Skripte (CSP). Netlify-CSP bleibt unverändert: Dateien werden über einen signierten Link in einem **neuen Tab** geöffnet, nicht eingebettet.
- Schreibrechte: Büro = `app.ist_buero()` (admin, geschaeftsfuehrung, hr). Ausnahme: Studio-/Regionalleitung laden Onboarding-Unterlagen für zugeordnete Studios hoch und vermerken „abgelehnt“ per Upload.
- Sichtbarkeit immer über `app.sieht(stufe, standort)` / `app.sieht_person(stufe, ma)`; neue Funktionen `security definer set search_path = ''`, `revoke … from public, anon`, `grant … to authenticated`.
- **Nichts wird gelöscht:** `delete` auf `vertragsstand`, `entgelt`, `dokument`, `stammdaten_aenderung`, `onboarding_klaerung` wird per Trigger abgewiesen, außer `auth.uid() is null` (Betreiber direkt per SQL).
- Fehlermeldungen auf Deutsch, Du-Form, konkret („Für den 01.07.2026 gibt es schon einen Stand.“); Zahlen über `app.zahl()` / `app.betrag()`, Datum als TT.MM.JJJJ (`to_char(d, 'DD.MM.YYYY')`).
- Dateien: PDF, JPG, PNG; höchstens 10 MB (10485760 Byte); Bucket `personalakte`, privat; Pfad `<org>/<dv>/<kategorie>/<uuid>.<pdf|jpg|png>`; signierte Links 300 Sekunden gültig.
- Dokument-Kategorien (genau diese Werte): `anmeldung`, `onboarding`, `vereinbarung`, `abmeldung`, `nachweis_personendaten`, `nachweis_lohnverrechnung`, `sonstiges`.
- Zusatzstufe je Kategorie (zusätzlich zu `dokumente`): `vereinbarung` → `entgelt`; `anmeldung`, `abmeldung`, `nachweis_lohnverrechnung` → `lohnverrechnung`; `nachweis_personendaten` → `personendaten`; `onboarding`, `sonstiges` → keine.
- Stammdaten-Felder: Personendaten = `anrede, vorname, nachname, geburtsdatum, strasse, plz, ort`; Kontakt = `telefon, email` (Stufe Personendaten für die Nachweise, weil Kontakt keine Dokumente kennt); Lohnverrechnung = `sv_nummer, iban, bic, staatsangehoerigkeit`.
- Stammdatenänderung: gültig ab frühestens heute − 90 Tage, spätestens heute (*Entscheidung von Claude: künftige Stammdaten bräuchten einen zeitgesteuerten Job; nicht Teil dieses Projekts*). `geburtsdatum` ist ergänzt (*Entscheidung von Claude: Tippfehler beim Geburtsdatum müssen korrigierbar sein*).
- Stundenanpassung: gültig ab ≥ Dienstantritt, > letzter nicht stornierter Stand, ≤ heute + 365, nicht nach dem Austritt. Der erste Stand (aus dem Dienstzettel) kann nicht storniert werden.
- Migrationen über das Supabase-MCP-Werkzeug `apply_migration`, Dateien unter `supabase/migrations/20261122…`; Push mit `git -c push.negotiate=true push`; Commit-Nachrichten enden mit den zwei Attributionszeilen aus dem Handbuch.
- Bedienung am iPad: Knöpfe und Reiter mindestens 44 px hoch; Datei-Auswahl mit `accept="application/pdf,image/jpeg,image/png"` (iPad bietet dann Kamera an).

## Prüfschwerpunkte (Review Focus)

1. **Doppelt gespeichert** (Doppelklick oder zwei Büro-Leute, gleiches „gültig ab“) → zweiter Versuch bekommt „Für den TT.MM.JJJJ gibt es schon einen Stand.“, kein zweiter Stand. Test in Task 4.
2. **Datei hochgeladen, aber Eintrag schlägt fehl** (Netz weg, falscher Pfad, fremde Firma) → `dokument_ablegen` lehnt Pfade ab, die nicht im Bucket liegen oder nicht zu Firma/Dienstverhältnis/Kategorie passen; ein erneuter Versuch mit derselben Datei klappt. Test in Task 3.
3. **Anpassung nach Austritt oder vor Dienstantritt** → klare Ablehnung. Test in Task 4.
4. **Neuer Wert gleich altem Wert** (auch IBAN mit Leerzeichen/Kleinbuchstaben) → wird normalisiert und als „unverändert“ abgelehnt, kein leerer Änderungseintrag. Test in Task 5.
5. **Onboarding-Unterlage später deaktiviert oder auf „nur Büro“ gestellt** → bereits hochgeladene Dokumente bleiben unter „Dokumente“ sichtbar, die Checkliste zählt nur aktive, passende Unterlagen. Test in Task 6.

---

## Dateien im Überblick

| Datei | Aufgabe |
|---|---|
| `supabase/migrations/20261122000011_gemeinsame_pruefregeln.sql` | `app.arbeitszeit_pruefen`, `app.brutto_fuer`, `dienstzettel_erfassen` nutzt beide |
| `…0012_vertragsstand.sql` | Tabelle `vertragsstand`, `app.stand_am`, Löschschutz, Verzeichnis liest aktuellen Stand |
| `…0013_dokumente_ablage.sql` | `dokument`-Erweiterung, Sichtbarkeit je Kategorie, Bucket + Storage-Regeln, `dokument_ablegen` |
| `…0014_stundenanpassung.sql` | `stunden_anpassen`, `stand_stornieren` |
| `…0015_stammdatenaenderung.sql` | Tabelle `stammdaten_aenderung`, `stammdaten_aendern`, `sv_nummer_nachtragen`, Schreibsperre |
| `…0016_onboarding.sql` | `onboarding_unterlage`, `onboarding_klaerung`, `onboarding_stand`, `onboarding_vermerken`, `klaerung_schliessen` |
| `…0017_akte_offene_punkte.sql` | `akte_kopf`, `akte_protokoll`, `offene_punkte` |
| `supabase/tests/*.sql` | Datenbank-Tests je Aufgabe (laufen in einer Transaktion mit `rollback`) |
| `supabase/seed_demo.sql` | + vier Demo-Onboarding-Unterlagen |
| `app/pruefungen.js` | + `arbeitszeitPruefen`, `stundenanpassungPruefen`, `stammdatenFeldPruefen` |
| `app/datei.js` (neu) | `dateiPruefen`, `sha256`, `dateiPfad` |
| `app/api.js` | + `hochladen`, `dateiLink` |
| `app/akte.js` (neu) | Akte-Seite, Reiter, Übersicht |
| `app/akte_verlauf.js` (neu) | Reiter „Anstellung & Verlauf“ + Formular Stundenanpassung |
| `app/akte_dokumente.js` (neu) | Reiter „Dokumente“ + Hochladen |
| `app/akte_stammdaten.js` (neu) | Reiter „Lohnverrechnung“ + Formular „Änderung eintragen“ (auch für Personendaten) |
| `app/offene_punkte.js` (neu) | Seite „Offene Punkte“ |
| `app/einstellungen.js` | + Abschnitt Onboarding-Unterlagen |
| `app/app.js`, `app/index.html`, `app/style.css` | Routen `#akte/…`, `#offen`, Name in der Liste als Link, Stil für Reiter |
| `tests/unit/*.test.mjs` | Einheitstests (Node `node:test`) |
| `tests/ui/mock.js`, `tests/ui/akte.test.js` | Browser-Test mit simulierten Supabase-Antworten |
| `docs/handbuch.md` | + Akte, Stundenanpassung, Dokumente, Onboarding, Offene Punkte, Tests ausführen |

**So laufen Tests**
- Datenbank: Inhalt einer `supabase/tests/<name>.sql` mit `execute_sql` ausführen. Jede Datei beginnt mit `begin;`, endet mit `rollback;`, prüft mit `do $$ … $$`-Blöcken und meldet Fehler per `raise exception 'FEHLER: …'`. Letzte Zeile vor `rollback`: `select 'alle Tests bestanden' as ergebnis;`. Bestanden = genau diese Zeile kommt zurück.
- Benutzer simulieren (Hilfsdatei `supabase/tests/_hilfen.sql`, wird jeder Testdatei vorangestellt): `pg_temp.als(a_user uuid)` setzt `role authenticated` und `request.jwt.claims` mit `sub`; `pg_temp.benutzer(a_rolle text, a_standorte uuid[]) returns uuid` legt in der Transaktion einen `auth.users`-Eintrag, ein `profil` in der Demo-Firma und `zustaendigkeit` an; `pg_temp.mitarbeiter_anlegen(a_standort uuid, a_funktion uuid) returns uuid` ruft als Büro `dienstzettel_erfassen` mit gültigen Demo-Werten (SV `1238010190`, IBAN `AT611904300234573201`, Eintritt heute, teilzeit 20 h / 5 Tage / 1000 €) und gibt die Dienstverhältnis-ID zurück; `pg_temp.erwarte_fehler(a_sql text, a_text text)` führt SQL aus und scheitert, wenn kein Fehler mit diesem Textteil kommt.
- Einheitstests: `node --test tests/unit/` → alle `ok`.
- Browser: `NODE_PATH=$(npm root -g) node tests/ui/akte.test.js app /tmp/ui` → letzte Zeile `UI-Tests bestanden`, keine `pageerror`, Bildschirmfotos in `/tmp/ui`.

---

### Aufgabe 1: Gemeinsame Prüfregeln und Test-Grundlage

**Dateien:**
- Neu: `supabase/migrations/20261122000011_gemeinsame_pruefregeln.sql`, `supabase/tests/_hilfen.sql`, `supabase/tests/01_pruefregeln.sql`, `tests/unit/pruefungen.test.mjs`, `tests/ui/mock.js`
- Ändern: `app/pruefungen.js`

**Schnittstellen:**
- Liefert: `app.arbeitszeit_pruefen(p_org public.organisation, p_art text, p_stunden numeric, p_tage int, p_netto numeric) returns void` (wirft die bisherigen Meldungen von `dienstzettel_erfassen` wortgleich); `app.brutto_fuer(p_org uuid, p_tarifzone uuid, p_netto numeric, p_stichtag date) returns numeric` (null = „offen“).
- Liefert: `arbeitszeitPruefen(w, regeln) -> {feld: meldung}` mit `w = {beschaeftigungsart, wochenstunden, arbeitstage, netto}` (Strings aus dem Formular), Feldnamen `beschaeftigungsart | wochenstunden | arbeitstage | netto`.
- Liefert: `tests/ui/mock.js` exportiert `starte({ app, daten, rpc })` → `{ page, browser, fehler, anfragen, schliessen() }`; `daten` = Tabellen wie im bisherigen Test, `rpc` = `{ name: (body) => antwort }`; Storage-Aufrufe unter `/storage/v1/` werden in `anfragen` gesammelt und mit `{ Key }` bzw. `{ signedURL }` beantwortet.

- [ ] **Schritt 1: Einheitstest schreiben** – `tests/unit/pruefungen.test.mjs`:
  - `arbeitszeitPruefen` mit `{vollzeit, 40, 5, 1500}` und Regeln `{vollzeit_stunden: 40, max_stunden_tag: 10, geringfuegig_grenze: 551.10}` → `{}`.
  - `{teilzeit, 40, 1, 1000}` → `wochenstunden` enthält „40 Stunden an 1 Tag sind 40 Stunden pro Tag“.
  - `{vollzeit, 30, 5, …}` → „Vollzeit sind 40 Stunden“.
  - `{geringfuegig, 8, 2, 600}` → `netto` enthält „551,10“.
  - `dienstzettelPruefen` liefert für dieselben Fälle dieselben Meldungen wie vorher (ein Fall reicht, z. B. 40 h / 1 Tag).
- [ ] **Schritt 2:** `node --test tests/unit/` → FAIL („arbeitszeitPruefen is not a function“).
- [ ] **Schritt 3:** `arbeitszeitPruefen` aus dem Abschnitt „Arbeitszeit“ und „Entgelt“ (ohne Leiterzulage) von `dienstzettelPruefen` herauslösen; `dienstzettelPruefen` ruft sie auf und übernimmt ihr Ergebnis.
- [ ] **Schritt 4:** `node --test tests/unit/` → PASS.
- [ ] **Schritt 5: DB-Test schreiben** – `_hilfen.sql` (siehe „So laufen Tests“) und `01_pruefregeln.sql`: `app.arbeitszeit_pruefen` wirft bei 40 h / 1 Tag „Höchstens 10 Stunden pro Tag“, bei vollzeit 30 h „Vollzeit sind bei euch 40 Stunden“, bei geringfügig 600 € „551,10“; `app.brutto_fuer(Demo, Standard, 1000, heute)` = 1300.00, für 1013 € = null; `pg_temp.mitarbeiter_anlegen` funktioniert (Dienstzettel unverändert).
- [ ] **Schritt 6:** Test ausführen → FAIL („function app.arbeitszeit_pruefen does not exist“).
- [ ] **Schritt 7:** Migration 011: beide Funktionen anlegen; in `dienstzettel_erfassen` (Fassung aus 008) die Blöcke „Arbeitszeit“ und die Geringfügig-Prüfung durch `perform app.arbeitszeit_pruefen(...)` und die Brutto-Abfrage durch `app.brutto_fuer(...)` ersetzen. Alle übrigen Zeilen bleiben wortgleich.
- [ ] **Schritt 8:** `apply_migration`, Test erneut → „alle Tests bestanden“.
- [ ] **Schritt 9:** `tests/ui/mock.js` aus dem bisherigen Scratchpad-Test (`ui-test/test.js`) erzeugen; einen Rauchtest (Anmelden als HR, Dienstzettel-Seite sichtbar, keine `pageerror`) direkt in `mock.js` unter `if (require.main === module)` laufen lassen → bestanden.
- [ ] **Schritt 10: Commit** `git add -A supabase app/pruefungen.js tests && git commit -m "Prüfregeln gemeinsam nutzen, Testgrundlage im Repo"`

### Aufgabe 2: Vertragsstand als einzige Quelle für Stunden

**Dateien:**
- Neu: `supabase/migrations/20261122000012_vertragsstand.sql`, `supabase/tests/02_vertragsstand.sql`

**Schnittstellen:**
- Liefert Tabelle `public.vertragsstand (id, organisation_id, dienstverhaeltnis_id, gueltig_ab date, beschaeftigungsart, wochenstunden numeric(4,1), arbeitstage_woche int, storniert_am timestamptz, storniert_von uuid, storno_grund text, created_at, created_by)`; Fremdschlüssel `(dienstverhaeltnis_id, organisation_id)`; eindeutiger Teilindex `(dienstverhaeltnis_id, gueltig_ab) where storniert_am is null`; `unique (id, organisation_id)`.
- Liefert `app.stand_am(p_dv uuid, p_tag date) returns public.vertragsstand` (letzter nicht stornierter Stand mit `gueltig_ab <= p_tag`).
- Liefert `app.loeschen_verboten()` (Trigger-Funktion, Meldung „Einträge in der Personalakte werden nie gelöscht.“).
- Spalte `entgelt.vertragsstand_id uuid` und `entgelt.storniert_am timestamptz`; der bisherige `unique (dienstverhaeltnis_id, gueltig_ab)` wird ein Teilindex `where storniert_am is null`.

- [ ] **Schritt 1: Test schreiben** – `02_vertragsstand.sql`:
  - Nach `pg_temp.mitarbeiter_anlegen` gibt es genau einen Vertragsstand (gueltig_ab = Eintritt, teilzeit, 20, 5) und das Entgelt verweist darauf.
  - `app.stand_am(dv, heute).wochenstunden = 20`.
  - `update dienstverhaeltnis set wochenstunden = 30` als HR → Fehler „Stunden ändern nur über eine Stundenanpassung“.
  - `delete from vertragsstand` / `delete from entgelt` / `delete from dokument` als HR → Fehler „nie gelöscht“.
  - `mitarbeiter_verzeichnis()` liefert die Stunden aus `app.stand_am`.
  - Studioleitung eines fremden Studios sieht den Vertragsstand nicht; HR sieht ihn; Verwaltung (ohne Personendaten) sieht ihn nicht.
- [ ] **Schritt 2:** Ausführen → FAIL („relation public.vertragsstand does not exist“).
- [ ] **Schritt 3:** Migration 012: Tabelle, Index, RLS-Regel `nach_recht` (select, `app.sieht('personendaten', app.standort_von(dienstverhaeltnis_id))`), **keine** Schreibregeln; Trigger `after insert on dienstverhaeltnis` legt den ersten Stand an und verknüpft das Entgelt mit gleichem Datum (Achtung: `dienstzettel_erfassen` legt das Entgelt *nach* dem Dienstverhältnis an → stattdessen im Entgelt-Insert-Trigger `before insert` die `vertragsstand_id` auf den Stand mit gleichem `gueltig_ab` setzen, falls leer); Nachtrag für bestehende Dienstverhältnisse; Trigger `before update` auf `dienstverhaeltnis`, der Änderungen an `beschaeftigungsart, wochenstunden, arbeitstage_woche, eintritt` bei `auth.uid() is not null` abweist; Löschschutz-Trigger auf `vertragsstand, entgelt, dokument`; Audit-Trigger `app.audit()` auf `vertragsstand`; `mitarbeiter_verzeichnis` liest `beschaeftigungsart` und `wochenstunden` aus `app.stand_am(d.id, current_date)` (sonst unverändert).
- [ ] **Schritt 4:** `apply_migration`, Tests 01 und 02 → bestanden.
- [ ] **Schritt 5: Commit** „Vertragsstand: Stunden mit gültig ab, Löschschutz“.

### Aufgabe 3: Dokumente, Kategorien und Dateiablage

**Dateien:**
- Neu: `supabase/migrations/20261122000013_dokumente_ablage.sql`, `supabase/tests/03_dokumente.sql`, `app/datei.js`, `tests/unit/datei.test.mjs`
- Ändern: `app/api.js`

**Schnittstellen:**
- Neue Spalten in `dokument`: `kategorie text not null default 'sonstiges'` (Werte siehe Globale Vorgaben), `vertragsstand_id uuid`, `onboarding_unterlage_id uuid` (Fremdschlüssel kommt in Aufgabe 6), `onboarding_ergebnis text check in ('unterschrieben','abgelehnt')`, `datei_typ text`, `datei_groesse int`, `hochgeladen_am timestamptz`, `hochgeladen_von uuid`, `ersetzt_durch uuid` (→ dokument), `ersetzt_am timestamptz`. Nachtrag: `kategorie` aus `typ` (dienstzettel/dienstvertrag/einzelvereinbarung → vereinbarung, anmeldebestaetigung → anmeldung, onboarding → onboarding, sonst sonstiges).
- `app.zusatzstufe(p_kategorie text) returns text` (null für onboarding/sonstiges); `app.sieht_dokument(p_kategorie text, p_dv uuid) returns boolean`; `app.darf_hochladen(p_kategorie text, p_dv uuid) returns boolean` (Büro + `sieht_dokument`, oder Leitung + Kategorie `onboarding` + `app.sieht('dokumente', standort)`).
- `public.dokument_ablegen(p_pfad text, p_hash text, p_kategorie text, p_bezeichnung text, p_dienstverhaeltnis_id uuid, p_dokument_id uuid default null, p_onboarding_unterlage_id uuid default null, p_onboarding_ergebnis text default null) returns uuid`:
  - `p_dokument_id` = bestehender Eintrag: ohne Datei → Datei wird ergänzt; mit Datei → **ersetzen** (nur Büro): neuer Eintrag mit denselben Bezügen, alter bekommt `ersetzt_durch`/`ersetzt_am`.
  - Prüft: Pfad = `<org>/<p_dienstverhaeltnis_id>/<p_kategorie>/…`, Objekt existiert in `storage.objects` (Bucket `personalakte`), Größe/Typ aus `metadata`, `darf_hochladen`.
  - Ab Aufgabe 6 zusätzlich: Klärung anlegen bei abgelehnter Pflichtunterlage (Erweiterungspunkt: Aufruf `app.onboarding_nach_ablage(dokument_id)`, in Aufgabe 3 als leere Funktion angelegt).
- JS `app/datei.js`: `dateiPruefen(datei: File) -> string|null` („Nur PDF, JPG oder PNG.“ / „Die Datei ist größer als 10 MB.“); `sha256(datei: File) -> Promise<string>` (hex, `crypto.subtle`); `dateiPfad(org, dv, kategorie, typ) -> string` (`crypto.randomUUID()`, Endung aus Typ).
- JS `api.js`: `hochladen(pfad: string, datei: File) -> Promise<void>` (POST `/storage/v1/object/personalakte/<pfad>`, `x-upsert: false`); `dateiLink(pfad: string, herunterladen = false) -> Promise<string>` (POST `/storage/v1/object/sign/personalakte/<pfad>` mit `{expiresIn: 300}`, Ergebnis-URL absolut machen, `&download` anhängen wenn gewünscht).

- [ ] **Schritt 1: Einheitstest** `datei.test.mjs`: `dateiPruefen({type: "application/pdf", size: 10485760})` → null; `size: 10485761` → „größer als 10 MB“; `type: "image/gif"` → „Nur PDF, JPG oder PNG.“; `dateiPfad("o","d","onboarding","image/jpeg")` passt auf `/^o\/d\/onboarding\/[0-9a-f-]{36}\.jpg$/`.
- [ ] **Schritt 2:** `node --test tests/unit/` → FAIL. **Schritt 3:** `datei.js` schreiben. **Schritt 4:** PASS.
- [ ] **Schritt 5: DB-Test** `03_dokumente.sql` (Storage-Objekte werden im Test direkt in `storage.objects` eingefügt, mit `metadata = {"size":1234,"mimetype":"application/pdf"}`):
  - HR legt ein Onboarding-Dokument ab → `hochgeladen_von`, `datei_hash`, `kategorie` gesetzt.
  - Pfad mit anderer Firma oder anderem Dienstverhältnis → Fehler „passt nicht“; Pfad ohne Objekt → Fehler „Datei nicht gefunden“; danach mit korrektem Pfad → klappt (Prüfschwerpunkt 2).
  - Ersetzen durch HR → alter Eintrag hat `ersetzt_durch`, neuer existiert, beide sichtbar.
  - Ersetzen durch Studioleitung → Fehler „Ersetzen kann nur das Personalbüro“.
  - Studioleitung (zugeordnet) legt Onboarding ab → klappt; Kategorie `vereinbarung` → Fehler; fremdes Studio → Fehler.
  - Sichtbarkeit: Studioleitung (Dokumente ja, Entgelt nein) sieht Onboarding, nicht Vereinbarung; Buchhaltung (Dokumente nein) sieht keins; gleiche Regel auf `storage.objects` (select als Studioleitung zählt nur Onboarding-Pfade).
  - `update storage.objects` / `delete from storage.objects` als HR → 0 Zeilen bzw. verweigert.
- [ ] **Schritt 6:** Ausführen → FAIL. **Schritt 7:** Migration 013: Spalten, Nachtrag, Funktionen, `nach_recht` auf `dokument` ersetzen durch `app.sieht_dokument(kategorie, dienstverhaeltnis_id)`, `eigene_dokumente` bleibt; Bucket per `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('personalakte','personalakte',false,10485760,'{application/pdf,image/jpeg,image/png}')`; Storage-Regeln: `insert` mit `bucket_id = 'personalakte' and app.darf_hochladen((storage.foldername(name))[3], ((storage.foldername(name))[2])::uuid) and (storage.foldername(name))[1] = app.organisation_id()::text`, `select` analog mit `app.sieht_dokument`; keine `update`/`delete`-Regeln. Ungültige UUID im Pfad darf keinen Fehler werfen → Hilfsfunktion `app.als_uuid(text) returns uuid` (null bei ungültig).
- [ ] **Schritt 8:** `apply_migration`, Tests 01–03 → bestanden; `get_advisors(security)` → keine neuen Warnungen außer den gewollten `security definer`-Funktionen.
- [ ] **Schritt 9:** `api.js` um `hochladen` und `dateiLink` ergänzen (gleicher Kopf wie `anfrage`, aber Körper = Datei, `Content-Type` = Dateityp).
- [ ] **Schritt 10: Commit** „Dokumente: Kategorien, privater Speicher, nichts wird gelöscht“.

### Aufgabe 4: Stundenanpassung und Storno

**Dateien:**
- Neu: `supabase/migrations/20261122000014_stundenanpassung.sql`, `supabase/tests/04_stundenanpassung.sql`
- Ändern: `app/pruefungen.js`, `tests/unit/pruefungen.test.mjs`

**Schnittstellen:**
- `public.stunden_anpassen(p_dienstverhaeltnis_id uuid, p_gueltig_ab date, p_beschaeftigungsart text, p_wochenstunden numeric, p_arbeitstage_woche int, p_netto numeric) returns uuid` (ID des Vertragsstands). Legt in einem Schritt an: Vertragsstand, Entgelt (gleiches Datum, `vertragsstand_id`, Brutto über `app.brutto_fuer` mit der Tarifzone des Heimstudios, `quelle` tabelle/offen), Dokument (`typ einzelvereinbarung`, `kategorie vereinbarung`, `bezeichnung 'Vereinbarung Stundenanpassung'`, `vertragsstand_id`, ohne Datei). Bestehende Zulagen bleiben unberührt.
- `public.stand_stornieren(p_vertragsstand_id uuid, p_grund text) returns void` – setzt `storniert_*` am Stand und `storniert_am` am zugehörigen Entgelt.
- JS `stundenanpassungPruefen(w, regeln, { eintritt, letzterStand, austritt }) -> {feld: meldung}`; `w = {gueltig_ab, beschaeftigungsart, wochenstunden, arbeitstage, netto}`; nutzt `arbeitszeitPruefen`; Feld `gueltig_ab` für die Datumsregeln.
- „Nachweis fehlt“ heißt überall: nicht stornierter Stand (außer dem ersten) ohne Dokument mit Datei (`datei_pfad is not null and ersetzt_durch is null`).

- [ ] **Schritt 1: DB-Test** `04_stundenanpassung.sql`:
  - HR: Anpassung ab heute + 30 auf vollzeit 40 / 5 / 1500 → `app.stand_am(dv, heute).wochenstunden = 20`, `app.stand_am(dv, heute+30).wochenstunden = 40`; Entgelt ab heute+30 mit Brutto 1950.00; Dokument ohne Datei vorhanden.
  - Gleicher Tag noch einmal → „Für den TT.MM.JJJJ gibt es schon einen Stand.“ (Prüfschwerpunkt 1).
  - Datum vor Eintritt → „vor dem Dienstantritt“; Datum vor letztem Stand → „Es gibt schon einen späteren Stand“; Datum nach `austritt` (im Test als Betreiber gesetzt) → „nach dem Austritt“ (Prüfschwerpunkt 3); heute + 366 → „mehr als 1 Jahr“.
  - 40 h / 1 Tag → Meldung aus `arbeitszeit_pruefen`.
  - Studioleitung und Regionalleitung → „Stundenanpassungen trägt das Personalbüro ein.“
  - Storno ohne Grund → „Bitte einen Grund angeben.“; mit Grund → Stand zählt nicht mehr, danach gleiches Datum erneut möglich; Storno des ersten Stands → „Der Stand aus dem Dienstzettel kann nicht storniert werden.“
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Migration 014. **Schritt 4:** `apply_migration`, Tests 01–04 → bestanden.
- [ ] **Schritt 5: Einheitstest** für `stundenanpassungPruefen`: Datum vor `eintritt` → `gueltig_ab` gesetzt; Datum = `letzterStand` → `gueltig_ab` gesetzt; gültiger Fall → `{}`; 40 h / 1 Tag → `wochenstunden` gesetzt. FAIL → umsetzen → PASS.
- [ ] **Schritt 6: Commit** „Stundenanpassung mit Nachweis-Pflicht und Storno“.

### Aufgabe 5: Stammdatenänderungen mit altem Wert

**Dateien:**
- Neu: `supabase/migrations/20261122000015_stammdatenaenderung.sql`, `supabase/tests/05_stammdaten.sql`
- Ändern: `app/pruefungen.js`, `tests/unit/pruefungen.test.mjs`

**Schnittstellen:**
- Tabelle `public.stammdaten_aenderung (id, organisation_id, mitarbeiter_id, feld text, stufe text ('personendaten'|'lohnverrechnung'), alt text, neu text, gueltig_ab date, grund text not null, ist_ergaenzung boolean default false, dokument_id uuid, created_at, created_by)`; kein Update, kein Löschen (Trigger); RLS select: `app.sieht_person(stufe, mitarbeiter_id)`; keine Schreibregeln.
- `public.stammdaten_aendern(p_mitarbeiter_id uuid, p_werte jsonb, p_gueltig_ab date, p_grund text) returns uuid` (Dokument-ID). `p_werte` = `{"feld": "neuer Wert", …}`, nur Felder einer Stufe je Aufruf („Bitte Personendaten und Lohnverrechnungsdaten getrennt eintragen.“). Normalisiert wie `dienstzettel_erfassen` (trim, IBAN/BIC groß ohne Leerzeichen, SV ohne Leerzeichen, E-Mail klein), prüft wie dort (PLZ, Telefon, E-Mail, SV-Prüfziffer, IBAN, Alter ≥ 15 zum Eintritt), weist unveränderte Felder ab („Name ist unverändert.“), wenn kein Feld übrig bleibt. Eine Zeile je Feld, ein Dokument (`kategorie nachweis_personendaten` bzw. `nachweis_lohnverrechnung`, `bezeichnung 'Nachweis Stammdatenänderung'`, an das jüngste Dienstverhältnis der Person gehängt), dann Update der Werte.
- `public.sv_nummer_nachtragen(p_mitarbeiter_id uuid, p_sv_nummer text) returns void` – nur wenn `sv_nummer_nachreichen` und noch keine Nummer; Eintrag mit `ist_ergaenzung = true`, `grund 'Nachgereicht'`, ohne Dokument; setzt `sv_nummer_nachreichen = false`.
- Schreibsperre: Trigger `before update` auf `mitarbeiter` und `mitarbeiter_sensibel` weist Änderungen der Stammdaten-Felder ab, außer `current_setting('app.stammdaten_freigabe', true) = 'an'` (wird von beiden Funktionen mit `set_config(…, true)` gesetzt) oder `auth.uid() is null`.
- JS `stammdatenFeldPruefen(feld: string, wert: string) -> string|null` (gleiche Regeln, gleiche Texte wie `dienstzettelPruefen`; daraus herauslösen, nicht kopieren).

- [ ] **Schritt 1: DB-Test** `05_stammdaten.sql`:
  - HR ändert Nachname (Heirat) → `mitarbeiter.nachname` neu, ein Eintrag mit altem und neuem Wert, Dokument ohne Datei in `nachweis_personendaten`.
  - IBAN ändern auf dieselbe IBAN mit Leerzeichen und Kleinbuchstaben → „IBAN ist unverändert.“ (Prüfschwerpunkt 4); falsche IBAN → „Die IBAN ist ungültig.“
  - Personendaten und IBAN in einem Aufruf → „getrennt eintragen“.
  - gültig ab heute − 91 → „mehr als 3 Monate zurück“; morgen → „kann nicht in der Zukunft liegen“; Grund leer → „Bitte einen Grund angeben.“
  - `update mitarbeiter set nachname = 'X'` direkt als HR → „nur über ‚Änderung eintragen‘“.
  - Regionalleitung (Personendaten ja, Lohnverrechnung nein) sieht die Namensänderung, nicht die IBAN-Änderung; Regionalleitung ruft `stammdaten_aendern` → „trägt das Personalbüro ein“.
  - `sv_nummer_nachtragen` bei Person mit „wird nachgereicht“ → klappt, zweites Mal → „schon eingetragen, bitte über ‚Änderung eintragen‘“.
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Migration 015. **Schritt 4:** `apply_migration`, Tests 01–05 → bestanden.
- [ ] **Schritt 5: Einheitstest** `stammdatenFeldPruefen`: `("plz","80")` → „4 oder 5 Ziffern.“; `("iban","AT61 1904 3002 3457 3201")` → null; `("sv_nummer","1238010191")` → Prüfziffer-Meldung; `dienstzettelPruefen` unverändert. FAIL → umsetzen → PASS.
- [ ] **Schritt 6: Commit** „Stammdatenänderungen mit altem Wert und Nachweis“.

### Aufgabe 6: Onboarding-Unterlagen und Klärung

**Dateien:**
- Neu: `supabase/migrations/20261122000016_onboarding.sql`, `supabase/tests/06_onboarding.sql`
- Ändern: `supabase/seed_demo.sql`

**Schnittstellen:**
- Tabelle `public.onboarding_unterlage (id, organisation_id, bezeichnung text not null, reihenfolge int not null default 0, pflicht boolean not null default false, gilt_fuer text not null default 'beide' check in ('studio','buero','beide'), aktiv boolean not null default true, created_at)`; RLS: alle der Firma lesen, Büro `insert`/`update`, kein Löschen (Trigger). `dokument.onboarding_unterlage_id` bekommt jetzt den Fremdschlüssel.
- Tabelle `public.onboarding_klaerung (id, organisation_id, dienstverhaeltnis_id, onboarding_unterlage_id, dokument_id, erstellt_am, geschlossen_am, geschlossen_von, vermerk)`; eindeutig offen je (Dienstverhältnis, Unterlage); RLS select `app.sieht('dokumente', standort)`; schreiben nur über Funktionen.
- `public.onboarding_stand(p_dienstverhaeltnis_id uuid) returns table (unterlage_id uuid, bezeichnung text, pflicht boolean, reihenfolge int, status text, dokument_id uuid)`; `status` ∈ `erledigt | abgelehnt | klaerung | geklaert | fehlt`; nur aktive Unterlagen, deren `gilt_fuer` zu `standort.art` passt (`beide` passt immer); Dokument zählt nur ohne `ersetzt_durch`; wirft „Keine Berechtigung“, wenn `app.sieht('dokumente', …)` falsch ist. Als erledigt zählen alle außer `fehlt` und `klaerung`.
- `app.onboarding_nach_ablage(p_dokument uuid)` (aus Aufgabe 3) legt bei `onboarding_ergebnis = 'abgelehnt'` und Pflichtunterlage eine offene Klärung an.
- `public.onboarding_vermerken(p_dienstverhaeltnis_id uuid, p_unterlage_id uuid, p_vermerk text) returns uuid` – nur Büro; Ablehnung ohne Datei (Dokument mit `onboarding_ergebnis 'abgelehnt'`, Vermerk in `bezeichnung`), sonst wie Ablage.
- `public.klaerung_schliessen(p_klaerung_id uuid, p_vermerk text) returns void` – nur Büro, Vermerk Pflicht.
- Demo-Daten: Einverständnis Stundenaufzeichnung (1, Pflicht, beide), Bildaufnahme (2, Pflicht, beide), Arbeitsanweisung (3, Pflicht, beide), Aushändigung Arbeitskleidung (4, Pflicht, studio).

- [ ] **Schritt 1: DB-Test** `06_onboarding.sql` (Demo-Unterlagen im Test anlegen, damit der Test nicht vom Seed abhängt):
  - Neuer Studio-Mitarbeiter → 4 × `fehlt`; Büro-Mitarbeiter → 3 Unterlagen (ohne Arbeitskleidung).
  - Ablage „Bildaufnahme“ mit Ergebnis `unterschrieben` → `erledigt`.
  - Freiwillige Unterlage mit `abgelehnt` → `abgelehnt`, keine Klärung.
  - Pflichtunterlage mit `abgelehnt` (Upload durch Studioleitung) → `klaerung`; Studioleitung schließt → „Klärungen schließt das Personalbüro“; HR schließt ohne Vermerk → Fehler, mit Vermerk → `geklaert`.
  - Unterlage deaktivieren oder auf `buero` stellen → verschwindet aus `onboarding_stand` des Studio-Mitarbeiters, das Dokument bleibt in `dokument` sichtbar (Prüfschwerpunkt 5).
  - Buchhaltung (keine Dokumente) → `onboarding_stand` wirft „Keine Berechtigung“.
  - `delete from onboarding_unterlage` als HR → „nie gelöscht“ (deaktivieren statt löschen).
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Migration 016 + Seed-Ergänzung (Seed einmal per `execute_sql` auf die Demo-Firma anwenden, nur die neuen Zeilen, mit `on conflict do nothing`). **Schritt 4:** Tests 01–06 → bestanden.
- [ ] **Schritt 5: Commit** „Onboarding-Unterlagen mit Pflicht, Ablehnung und Klärung“.

### Aufgabe 7: Akte-Kopf, Protokoll und „Wem fehlt was“

**Dateien:**
- Neu: `supabase/migrations/20261122000017_akte_offene_punkte.sql`, `supabase/tests/07_akte.sql`

**Schnittstellen:**
- `public.akte_kopf(p_dienstverhaeltnis_id uuid) returns jsonb` – wirft „Keine Berechtigung“, wenn die Person nicht in der Reichweite liegt (gleiche Regel wie `mitarbeiter_verzeichnis`). Schlüssel (fehlende Stufe ⇒ Schlüssel fehlt):
  - immer: `dienstverhaeltnis_id, mitarbeiter_id, vorname, nachname, funktion, arbeitsort (vertragsbezeichnung), gesellschaft, eintritt, austritt, befristet_bis, rechte {kontakt, personendaten, entgelt, lohnverrechnung, dokumente, buero, hochladen_onboarding}`
  - Kontakt: `telefon, email`
  - Personendaten: `anrede, geburtsdatum, strasse, plz, ort, stand {gueltig_ab, beschaeftigungsart, wochenstunden, arbeitstage_woche}, kuenftig [{…gleich}], nachweis_fehlt [gueltig_ab, …]`
  - Entgelt: `entgelt {netto, brutto, quelle}, zulagen [{art, netto}], sonderzahlung`
  - Lohnverrechnung: `sv_nachreichen`
  - Dokumente: `onboarding {erledigt, gesamt, fehlt [bezeichnung]}`
- `public.akte_protokoll(p_dienstverhaeltnis_id uuid) returns table (zeitpunkt timestamptz, wer text, tabelle text, aktion text, alt jsonb, neu jsonb)` – nur Büro; Einträge mit `datensatz_id` = Mitarbeiter oder Dienstverhältnis oder `neu/alt ->> 'dienstverhaeltnis_id'` = Dienstverhältnis oder `->> 'mitarbeiter_id'` = Mitarbeiter; `wer` = E-Mail aus `auth.users`; neueste zuerst, höchstens 200.
- `public.offene_punkte() returns table (dienstverhaeltnis_id uuid, vorname text, nachname text, standort_id uuid, art text, beschreibung text, datum date)`; `art` ∈ `onboarding | klaerung | nachweis_stunden | nachweis_stammdaten | sv_nummer`; Stufe je Art: onboarding/klaerung → dokumente, nachweis_stunden → personendaten, nachweis_stammdaten → Stufe des Eintrags, sv_nummer → lohnverrechnung; nur Dienstverhältnisse ohne Austritt oder mit Austritt in der Zukunft.

- [ ] **Schritt 1: DB-Test** `07_akte.sql`:
  - Verwaltung bekommt `akte_kopf` mit `telefon`, ohne `stand`, `entgelt`, `onboarding`.
  - Studioleitung (zugeordnet) bekommt `onboarding`, kein `entgelt`; fremdes Studio → „Keine Berechtigung“.
  - HR: nach Anpassung ab heute+30 enthält `kuenftig` einen Eintrag und `nachweis_fehlt` dessen Datum.
  - `offene_punkte()` als HR enthält für den neuen Mitarbeiter 4 × onboarding und 1 × nachweis_stunden; als Studioleitung kein `nachweis_stunden`, kein `sv_nummer`; ausgetretener Mitarbeiter erscheint nicht.
  - `akte_protokoll` als HR liefert Einträge zu Dienstverhältnis und Entgelt; als Regionalleitung → „Keine Berechtigung“.
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Migration 017. **Schritt 4:** Tests 01–07 → bestanden; `get_advisors(security)` und `get_advisors(performance)` ansehen, neue Fremdschlüssel ohne Index ergänzen.
- [ ] **Schritt 5: Commit** „Akte-Kopf, Protokoll und offene Punkte“.

### Aufgabe 8: Akte-Seite mit Übersicht

**Dateien:**
- Neu: `app/akte.js`, `tests/ui/akte.test.js`
- Ändern: `app/app.js` (Routen, Namen als Link), `app/index.html` (Bereich `#ansicht-akte` mit `<nav id="akte-reiter">` und `<section id="akte-inhalt">`), `app/style.css` (Reiter, Hinweise)

**Schnittstellen:**
- Konsumiert: `akte_kopf`, `onboarding_stand` (Aufgaben 6–7).
- Liefert: `akteZeigen(stand, dvId: string, reiter = "uebersicht") -> Promise<void>`; Reiter-Schlüssel `uebersicht | stunden | verlauf | dokumente | lohn | protokoll`; Adresse `#akte/<dv>/<reiter>`. Jeder weitere Reiter ist ein Modul mit `export async function zeigen(ziel: HTMLElement, kopf: object, stand: object, neuLaden: () => Promise<void>)`; `akte.js` hält die Zuordnung `{verlauf: verlaufZeigen, …}`.
- Sichtbare Reiter: Übersicht, Stunden immer; Verlauf bei `rechte.personendaten`; Dokumente bei `rechte.dokumente`; Lohnverrechnung bei `rechte.lohnverrechnung`; Protokoll bei `rechte.buero`.

- [ ] **Schritt 1: Browser-Test** `akte.test.js` (über `mock.js`), Teil „Übersicht“:
  - Liste als HR → Klick auf Namen öffnet `#akte/<dv>/uebersicht`; Kopf zeigt Name, Funktion, Arbeitsort, GmbH, „befristet bis TT.MM.JJJJ“.
  - Hinweise oben: „Nachweis fehlt (ab 01.…)“, „Versicherungsnummer wird nachgereicht“, „Onboarding unvollständig (1 von 4)“.
  - „ab TT.MM.JJJJ: 40 Stunden“ bei künftigem Stand; „Resturlaub: kommt mit der Stundenauswertung“.
  - Als Verwaltung: nur Übersicht und Stunden als Reiter; kein Entgelt-Block.
  - Reiter „Stunden“ zeigt den Platzhaltertext.
  - Bildschirmfoto `a-akte-hr.png` (1280 px) und `b-akte-ipad.png` (1024 × 768).
- [ ] **Schritt 2:** Ausführen → FAIL. **Schritt 3:** Umsetzen. **Schritt 4:** PASS, Bildschirmfotos ansehen (Lesbarkeit, Reiter ≥ 44 px).
- [ ] **Schritt 5: Commit** „Akte-Seite mit Übersicht“.

### Aufgabe 9: Reiter „Anstellung & Verlauf“

**Dateien:**
- Neu: `app/akte_verlauf.js`
- Ändern: `tests/ui/akte.test.js`

**Schnittstellen:**
- Konsumiert: Tabellen `vertragsstand` (mit `entgelt` über `vertragsstand_id`, nur wenn `rechte.entgelt`) und `dokument` (`vertragsstand_id`), RPC `stunden_anpassen`, `stand_stornieren`, `stundenanpassungPruefen`, `stand.bruttoTabelle` für die Vorschau.
- Liefert: `export async function zeigen(ziel, kopf, stand, neuLaden)`.

- [ ] **Schritt 1: Browser-Test**, Teil „Verlauf“: Tabelle mit allen Ständen (stornierte durchgestrichen, mit Grund); Spalte Vereinbarung zeigt „vorhanden“ bzw. „Nachweis fehlt“ (bei erstem Stand „Dienstzettel“); Formular vorbelegt mit aktuellem Stand; 40 h / 1 Tag zeigt Feldmeldung ohne RPC-Aufruf; gültige Eingabe zeigt „20 → 40 Stunden, Brutto € 1.950,00“ und sendet `stunden_anpassen` mit genau `{p_dienstverhaeltnis_id, p_gueltig_ab, p_beschaeftigungsart, p_wochenstunden, p_arbeitstage_woche, p_netto}`; Fehlertext aus der Datenbank erscheint im Formular; ohne `rechte.buero` kein Knopf; ohne `rechte.entgelt` keine Netto/Brutto-Spalten.
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Umsetzen (Storno über Knopf je Zeile mit Pflichtfeld Grund, ohne `confirm()`-Dialog). **Schritt 4:** PASS.
- [ ] **Schritt 5: Commit** „Verlauf und Stundenanpassung in der Akte“.

### Aufgabe 10: Reiter „Dokumente“ und Hochladen

**Dateien:**
- Neu: `app/akte_dokumente.js`
- Ändern: `tests/ui/akte.test.js`

**Schnittstellen:**
- Konsumiert: Tabelle `dokument` (Filter `dienstverhaeltnis_id`), `onboarding_stand`, `dateiPruefen`, `sha256`, `dateiPfad`, `api.hochladen`, `api.dateiLink`, RPC `dokument_ablegen`, `onboarding_vermerken`.
- Liefert: `export async function zeigen(ziel, kopf, stand, neuLaden)`; außerdem `export function hochladenDialog(ziel, { kategorie, bezeichnung, dokumentId, onboardingUnterlageId }, kopf, stand, fertig)` – wird auch von Verlauf („Nachweis hochladen“) und Lohnverrechnung genutzt.
- Ablauf Hochladen: prüfen → Pfad → `hochladen` → `sha256` → `dokument_ablegen`; schlägt der letzte Schritt fehl, bleibt der Dialog offen mit Meldung und „Erneut versuchen“ (ruft nur `dokument_ablegen` erneut).

- [ ] **Schritt 1: Browser-Test**, Teil „Dokumente“: Gruppen in der Reihenfolge Anmeldung, Onboarding, Vereinbarungen, Abmeldung, Nachweise, Sonstiges; ersetzte Dokumente unter „frühere Fassungen“; Onboarding-Checkliste mit Häkchen/„fehlt“/„Klärung mit Geschäftsführung“; GIF-Datei → „Nur PDF, JPG oder PNG.“ ohne Upload; PDF-Datei → Storage-POST an `personalakte/<org>/<dv>/onboarding/…pdf`, dann `dokument_ablegen` mit `p_hash` (64 Hex-Zeichen); „Ansehen“ ruft `object/sign` und öffnet einen neuen Tab; als Studioleitung nur Kategorie Onboarding wählbar und kein „Ersetzen“; simulierter Fehler bei `dokument_ablegen` → Meldung + „Erneut versuchen“ schickt keinen zweiten Storage-POST.
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Umsetzen; „Nachweis hochladen“ in `akte_verlauf.js` nutzt `hochladenDialog`. **Schritt 4:** PASS.
- [ ] **Schritt 5: Commit** „Dokumente hochladen, ansehen und ersetzen“.

### Aufgabe 11: Reiter „Lohnverrechnung“ und „Änderung eintragen“

**Dateien:**
- Neu: `app/akte_stammdaten.js`
- Ändern: `app/akte.js` (Knopf „Änderung eintragen“ in Übersicht für Personendaten/Kontakt), `tests/ui/akte.test.js`

**Schnittstellen:**
- Konsumiert: Tabellen `mitarbeiter_sensibel`, `stammdaten_aenderung`, RPC `stammdaten_aendern`, `sv_nummer_nachtragen`, `stammdatenFeldPruefen`, `hochladenDialog`.
- Liefert: `export async function zeigen(ziel, kopf, stand, neuLaden)` (Reiter Lohnverrechnung) und `export function aenderungDialog(ziel, stufe: "personendaten"|"lohnverrechnung", aktuell: object, kopf, fertig)`.

- [ ] **Schritt 1: Browser-Test**, Teil „Stammdaten“: Lohnverrechnung zeigt SV-Nummer (bzw. „wird nachgereicht“ mit Knopf „Nummer eintragen“), IBAN, BIC, Staatsangehörigkeit, darunter je Feld die früheren Werte mit Datum und Grund; Dialog verlangt gültig ab und Grund; unveränderte Felder werden nicht gesendet; ungültige IBAN zeigt Feldmeldung ohne RPC; erfolgreiche Änderung sendet `stammdaten_aendern` mit `p_werte` nur der geänderten Felder und bietet danach „Nachweis hochladen“ an; ohne `rechte.buero` keine Knöpfe.
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Umsetzen. **Schritt 4:** PASS.
- [ ] **Schritt 5: Commit** „Stammdatenänderungen in der Akte“.

### Aufgabe 12: Seite „Offene Punkte“, Protokoll und Onboarding-Einstellungen

**Dateien:**
- Neu: `app/offene_punkte.js`
- Ändern: `app/akte.js` (Reiter Protokoll), `app/einstellungen.js`, `app/index.html` (Navigation „Offene Punkte“ für Büro und Leitungen, Bereich `#ansicht-offen`, Abschnitt `#onboarding` in den Einstellungen), `app/app.js` (Route `#offen`), `tests/ui/akte.test.js`

**Schnittstellen:**
- Konsumiert: `offene_punkte()`, `akte_protokoll()`, Tabelle `onboarding_unterlage` über `api.lesen`/`api.aendern` und POST (neue Zeile; `api.anlegen(tabelle, werte)` in `api.js` ergänzen).
- Liefert: `offenePunkteZeigen(stand) -> Promise<void>`.
- Texte je Art: onboarding „Onboarding fehlt: <Unterlage>“, klaerung „Klärung mit Geschäftsführung: <Unterlage>“, nachweis_stunden „Nachweis fehlt: Stundenanpassung ab <Datum>“, nachweis_stammdaten „Nachweis fehlt: Änderung <Feld> ab <Datum>“, sv_nummer „Versicherungsnummer nachreichen“.

- [ ] **Schritt 1: Browser-Test**, Teil „Offene Punkte“: Liste je Mitarbeiter gruppiert, Filter Arbeitsort und Art, Klick führt in `#akte/<dv>/uebersicht`; leere Liste zeigt „Alles erledigt.“; Protokoll-Reiter als HR zeigt Zeitpunkt, wer, was; Einstellungen: Onboarding-Unterlage anlegen, Reihenfolge ändern, Pflicht umschalten, deaktivieren (kein Löschen-Knopf); Einstellungen-Abschnitt nur mit `darf_verwalten`.
- [ ] **Schritt 2:** FAIL. **Schritt 3:** Umsetzen. **Schritt 4:** PASS, alle Teile von `akte.test.js` und der Rauchtest aus `mock.js` laufen ohne `pageerror`.
- [ ] **Schritt 5: Commit** „Offene Punkte, Protokoll, Onboarding-Liste in den Einstellungen“.

### Aufgabe 13: Handbuch, Gesamtprüfung, Veröffentlichen

**Dateien:**
- Ändern: `docs/handbuch.md`, `README.md` (Verweis auf Tests)

- [ ] **Schritt 1:** Handbuch ergänzen (Anfängersprache): Akte und Reiter, wer was sieht (Tabelle aus Konzept §13), Stundenanpassung und Storno, „Nachweis fehlt“, Stammdatenänderung, Dokumente und Speicher (nichts wird gelöscht, Ersetzen), Onboarding-Liste pflegen, Offene Punkte, „So laufen die Tests“ (alle drei Arten mit Befehl), neue Tabellen und Funktionen im Glossar.
- [ ] **Schritt 2:** Alles prüfen: DB-Tests 01–07 → je „alle Tests bestanden“; `node --test tests/unit/` → alle ok; `akte.test.js` → „UI-Tests bestanden“; `get_advisors(security)` → nur bekannte Hinweise; Bildschirmfotos ansehen.
- [ ] **Schritt 3:** `git status` prüfen: keine Dateien aus `privat/`, keine echten Daten, kein Schlüssel außer dem öffentlichen in `config.js`.
- [ ] **Schritt 4: Commit und Push** „Handbuch: Personalakte“, `git -c push.negotiate=true push`.
