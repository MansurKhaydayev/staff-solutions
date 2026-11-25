# Staff-Solutions: Handbuch für den Betreiber

Dieses Handbuch erklärt, wie Staff-Solutions aufgebaut ist und wie du es betreibst.
Es wächst mit jeder neuen Funktion. Stand: 20.11.2026.

---

## 1. Der Aufbau in einem Bild

Staff-Solutions besteht aus drei Teilen, die an drei verschiedenen Orten liegen:

```
  Browser (Handy, iPad, PC)
        │  öffnet
        ▼
  ┌─────────────┐   holt Daten   ┌──────────────────────┐
  │  Die App    │ ─────────────► │  Die Datenbank        │
  │  (Netlify)  │ ◄───────────── │  (Supabase)           │
  └─────────────┘   nur erlaubte └──────────────────────┘
        ▲            Daten
        │ veröffentlicht automatisch
  ┌─────────────┐
  │  Der Code   │
  │  (GitHub)   │
  └─────────────┘
```

| Teil | Wo | Was es ist |
|---|---|---|
| **Code** | GitHub, Repository `staff-solutions` | Alle Dateien des Programms, mit vollständigem Verlauf jeder Änderung |
| **App** | Netlify | Die Webseite, die Benutzer öffnen. Netlify holt sich den Code von GitHub und veröffentlicht ihn automatisch. |
| **Datenbank** | Supabase (Region EU, Irland) | Alle Daten und **alle Regeln**: wer was sehen darf, Prüfungen, Berechnungen |

**Das Wichtigste:** Die Sicherheit liegt in der **Datenbank**, nicht in der App.
Die App zeigt nur an, was die Datenbank herausgibt. Selbst wenn jemand die App
umgeht, bekommt er keine Daten, die er nicht sehen darf.

---

## 2. Wo liegt was im Code

| Ordner / Datei | Inhalt |
|---|---|
| `app/index.html` | Aufbau aller Seiten: Anmeldung, Formular, Liste, Einstellungen |
| `app/style.css` | Aussehen: Farben, Schrift, Abstände |
| `app/app.js` | Ablauf der App: Daten laden, Formular, Mitarbeiterliste |
| `app/pruefungen.js` | Prüfregeln im Formular (Stunden, SV-Nummer, IBAN …) |
| `app/einstellungen.js` | Die Einstellungen-Seite (Rechte, Funktionen, Onboarding-Liste, Regeln) |
| `app/akte.js` | Personalakte: Seite, Reiter, Übersicht |
| `app/akte_verlauf.js` | Reiter „Anstellung & Verlauf“ und Stundenanpassung |
| `app/akte_dokumente.js` | Reiter „Dokumente“: hochladen, ansehen, ersetzen, Klärung schließen |
| `app/akte_stammdaten.js` | Reiter „Lohnverrechnung“ und „Änderung eintragen“ |
| `app/akte_protokoll.js` | Reiter „Protokoll“ |
| `app/offene_punkte.js` | Seite „Offene Punkte“ (wem fehlt was) |
| `app/datei.js` | Dateien prüfen (Typ, Größe), Fingerabdruck, Ablageort |
| `app/hilfen.js` | Kleine Hilfen für alle Seiten (Datum, Euro, Text) |
| `app/mappe.js`, `app/unterschrift.js` | Unterschriftsmappe am iPad, Unterschriftsfeld |
| `app/arbeitgeber.js` | Seite „Zu unterschreiben“ (Arbeitgeber) |
| `app/frist.js` | Fristregel für den Dienstantritt (Wiener Zeit) |
| `supabase/functions/mappe/` | Edge Function: erzeugt und legt das PDF der Mappe ab |
| `tests/` | Tests ohne Datenbank (Einheitstests, Browser-Tests) |
| `supabase/tests/` | Datenbank-Tests je Rolle |
| `app/api.js` | Verbindung zu Supabase |
| `app/config.js` | Adresse und öffentlicher Schlüssel der Datenbank |
| `supabase/migrations/` | Alle Änderungen an der Datenbank, nummeriert in der Reihenfolge, in der sie eingespielt wurden |
| `supabase/seed_demo.sql` | Die erfundene Demo-Firma |
| `vorlagen/demo/` | Vertragsvorlagen mit Platzhaltern wie `{{name}}` |
| `generator/` | Werkzeuge zum Befüllen von Vorlagen |
| `netlify.toml` | Einstellungen für Netlify |

**Beispiel:** Du willst den Text „Dienstzettel speichern“ auf dem Knopf ändern.
Er steht in `app/index.html`. Suche dort nach dem Text, ändere ihn, speichere, fertig.

---

## 3. Rollen und Rechte

### Die Datenstufen

| Stufe | Inhalt |
|---|---|
| Verzeichnis | Name, Funktion, Arbeitsort, Dienstantritt – sieht **jeder** mit Zugang |
| Kontakt | Telefon, E-Mail |
| Personendaten | Adresse, Geburtsdatum, Stunden, Befristung |
| Entgelt | Netto, Brutto, Zulagen |
| Lohnverrechnung | Versicherungsnummer, IBAN, Staatsangehörigkeit |
| Dokumente | Verträge und Vereinbarungen |

Dazu kommt die **Reichweite**: alle Standorte, nur zugeordnete Standorte oder nur die eigenen Daten.

### Voreinstellung für eine neue Firma

| Rolle | Kontakt | Personendaten | Entgelt | Lohnverr. | Dokumente | Reichweite | Anlegen | Verwalten |
|---|---|---|---|---|---|---|---|---|
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | alle | ✅ | ✅ |
| Geschäftsführung | ✅ | ✅ | ✅ | ✅ | ✅ | alle | ✅ | – |
| Personalbüro | ✅ | ✅ | ✅ | ✅ | ✅ | alle | ✅ | – |
| Buchhaltung | ✅ | ✅ | ✅ | ✅ | – | alle | – | – |
| Verwaltung | ✅ | – | – | – | – | alle | – | – |
| Regionalleitung | ✅ | ✅ | ✅ | – | ✅ | zugeordnete | ✅ | – |
| Studioleitung | ✅ | – | – | – | ✅ | zugeordnete | ✅ | – |
| Mitarbeiter | – | – | – | – | – | eigene | – | – |

### Rechte ändern

In der App unter **Einstellungen → Wer sieht was** ein Häkchen setzen oder entfernen.
Das gilt sofort. Nur Rollen mit „Verwalten“ (der Admin) sehen diese Seite.
Die Admin-Zeile selbst ist gesperrt, damit sich niemand aussperrt.

### Wer darf welche Funktion anlegen

Unter **Einstellungen → Funktionen**. Das Personalbüro darf immer alles.
Büro-Funktionen kann nur das Personalbüro anlegen, und nur mit dem Büro als Arbeitsort.

### Wo das technisch steht

- Tabelle `rollen_recht` in Supabase: die Häkchen je Firma und Rolle.
- Funktion `app.sieht(...)`: prüft bei jedem Zugriff, ob jemand eine Stufe für einen Standort sehen darf.
- Funktion `mitarbeiter_verzeichnis()`: liefert die Mitarbeiterliste und füllt nur die erlaubten Spalten.
- Migrationen `…009_berechtigungsprofile.sql` und `…010_rechte_rekursion.sql`.

---

## 4. Häufige Aufgaben

### Einen neuen Benutzer freischalten

Noch ohne eigene Seite in der App. So geht es über Supabase:

1. Supabase → **Authentication → Users → Add user → Create new user**.
   E-Mail und ein vorläufiges Passwort eingeben, **Auto Confirm User** anhaken.
2. Die **User UID** des neuen Benutzers kopieren.
3. Supabase → **SQL Editor**, diesen Text einfügen, die Werte ersetzen, **Run**:

```sql
insert into public.profil (user_id, organisation_id, rolle)
values ('USER-UID', (select id from public.organisation where name = 'Demo Fitness Gruppe'), 'verwaltung');
-- rolle: admin, geschaeftsfuehrung, hr, verwaltung, buchhaltung,
--        regionalleitung, studioleitung, mitarbeiter
```

4. Nur bei Regional- oder Studioleitung: die betreuten Studios zuordnen.

```sql
insert into public.zustaendigkeit (user_id, standort_id, organisation_id)
select 'USER-UID', s.id, s.organisation_id
from public.standort s
where s.name in ('Leoben', 'Bruck an der Mur');
```

**Regionalleiter wechselt das Gebiet:** alte Zuordnungen löschen, neue eintragen.

```sql
delete from public.zustaendigkeit where user_id = 'USER-UID';
```

### Ein Studio oder eine GmbH anlegen

Supabase → **Table Editor** → Tabelle `gesellschaft` bzw. `standort` → **Insert row**.
Beim Studio wichtig: richtige GmbH, richtige Tarifzone (Wien oder Standard)
und `vertragsbezeichnung` (z. B. „Fitnesshouse Bruck an der Mur“).

### Eine Änderung veröffentlichen

Jede Änderung am Code, die auf GitHub landet, veröffentlicht Netlify automatisch,
meist innerhalb einer Minute. Im Netlify-Dashboard unter **Deploys** siehst du,
ob es geklappt hat.

### Eine Änderung rückgängig machen

- **App:** Netlify → **Deploys** → eine frühere, funktionierende Version anklicken
  → **Publish deploy**. Damit ist die alte Version sofort wieder online.
- **Code:** Auf GitHub ist jede Änderung gespeichert. Eine frühere Fassung lässt
  sich jederzeit wiederherstellen.
- **Datenbank:** Änderungen an der Datenbank sind vorsichtiger zu behandeln.
  Nie einfach Tabellen löschen. Im Zweifel erst fragen.

---

## 5. Wenn etwas nicht funktioniert

| Wo schauen | Wie | Was du findest |
|---|---|---|
| **Browser** | In der App **F12** drücken → Reiter **Konsole** | Fehler der App, rot markiert |
| **Supabase** | Projekt → **Logs** | Fehler der Datenbank und Anmeldung |
| **Supabase** | Projekt → **Advisors** | Hinweise zu Sicherheit und Geschwindigkeit |
| **Netlify** | **Deploys** → letzte Veröffentlichung | Ob die App richtig veröffentlicht wurde |

Typische Meldungen:

| Meldung | Bedeutung |
|---|---|
| „Dein Zugang ist noch keiner Firma zugeordnet“ | Benutzer existiert, aber es fehlt der Eintrag in `profil` (siehe 4.) |
| „Diese Änderung ist für deinen Zugang nicht erlaubt“ | Die Datenbank hat die Änderung abgelehnt, weil die Rolle das Recht nicht hat |
| „Du bist für dieses Studio nicht zuständig“ | Bei Leitungen fehlt die Zuordnung in `zustaendigkeit` |
| Brutto „nicht in der Tabelle“ | Für diesen Netto-Betrag und diese Tarifzone gibt es keine Zeile in `brutto_tabelle` |

---

## 6. Grundregeln für Sicherheit

1. **Echte Mitarbeiterdaten gehören nie auf GitHub.** Nur in die Datenbank.
2. **Den geheimen Schlüssel** (service_role) aus Supabase nie in den Code oder in eine Nachricht kopieren. Der Schlüssel in `app/config.js` ist der öffentliche, der darf dort stehen.
3. **Vor dem echten Einsatz** in Supabase den Schutz vor gehackten Passwörtern einschalten (Authentication → Settings) und einen Vertrag zur Auftragsverarbeitung abschließen.
4. **Zum Testen nur erfundene Daten.**

## 7. Die Personalakte

Ein Klick auf einen Namen in der Mitarbeiterliste öffnet die Akte. Oben stehen Name, Funktion,
Arbeitsort, GmbH und der Status. Darunter, rot umrandet, die offenen Punkte dieser Person
(z. B. „Nachweis fehlt“). Die Reiter darunter zeigen nur, was die eigene Rolle sehen darf.

| Reiter | Inhalt | Wer sieht ihn |
|---|---|---|
| Übersicht | Person, Kontakt, Anstellung heute, Entgelt heute, Onboarding, Urlaub (kommt später) | jeder in seiner Reichweite, Teile nach Datenstufen |
| Stunden | Platzhalter, kommt mit der Stundenauswertung | jeder |
| Anstellung & Verlauf | alle Stände der Arbeitszeit mit „gültig ab“ | Personendaten (Beträge nur mit Entgelt) |
| Dokumente | Unterlagen nach Kategorie, Onboarding-Checkliste | Dokumente (je Kategorie zusätzlich die passende Stufe) |
| Lohnverrechnung | Versicherungsnummer, IBAN, BIC, Staatsangehörigkeit mit früheren Werten | Lohnverrechnung |
| Protokoll | wer hat wann was geändert | Personalbüro |

Ändern dürfen nur Admin, Geschäftsführung und Personalbüro. Ausnahme: Studio- und
Regionalleitung dürfen Onboarding-Unterlagen ihrer Studios hochladen.

### Stundenanpassung eintragen

1. Akte öffnen → **Anstellung & Verlauf** → **Stundenanpassung eintragen**.
2. „Gültig ab“, Beschäftigung, Stunden, Tage und Netto eintragen. Das Brutto kommt aus der Brutto-Tabelle.
3. Speichern. Es entstehen ein neuer Stand, ein Entgelt-Eintrag und eine Vereinbarung **ohne Datei**.
   Bis die unterschriebene Vereinbarung hochgeladen ist, steht überall **„Nachweis fehlt“**.
4. Unterschriebene Vereinbarung scannen → **Nachweis hochladen**.

Es gelten dieselben Regeln wie beim Dienstzettel. Zusätzlich: nicht vor dem Dienstantritt, nicht vor
dem letzten Stand, nicht nach dem Austritt, höchstens 1 Jahr im Voraus.

**Tippfehler?** Ein Stand wird nie gelöscht. **Stornieren** (mit Grund) – er bleibt durchgestrichen
sichtbar und zählt nicht mehr. Danach den richtigen Stand neu eintragen. Der Stand aus dem
Dienstzettel kann nicht storniert werden.

### Stammdaten ändern (Name, Adresse, Bank, Versicherungsnummer …)

Es gibt kein freies Überschreiben. Stattdessen **Änderung eintragen** (Übersicht für Person und
Kontakt, Reiter Lohnverrechnung für Bank und Versicherungsnummer): neuer Wert, gültig ab, Grund.
Der alte Wert bleibt sichtbar („bis 12.11.2026: …“). Danach den Nachweis hochladen.
Rückwirkend geht das höchstens 3 Monate, in die Zukunft gar nicht.

Eine **nachgereichte Versicherungsnummer** ist keine Änderung: Reiter Lohnverrechnung →
**Nummer eintragen**. Dafür braucht es keinen Nachweis.

### Dokumente

- Erlaubt sind PDF, JPG und PNG bis 10 MB. Am iPad kann man direkt fotografieren.
- Dateien liegen in einem **privaten** Speicher (Supabase Storage, Bereich `personalakte`).
  Ansehen geht nur über einen Link, der 5 Minuten gilt.
- **Nichts wird gelöscht.** Eine falsche Datei wird **ersetzt** (nur Büro). Die alte bleibt unter
  „frühere Fassungen“.
- Jede Datei bekommt einen **Fingerabdruck** (SHA-256). Damit lässt sich später zeigen, dass sie
  nicht verändert wurde.
- Wer welche Kategorie sieht: Onboarding und Sonstiges → Dokumente; Vereinbarungen → Dokumente
  und Entgelt; Anmeldung, Abmeldung, Nachweise zu Bank/Versicherung → Dokumente und
  Lohnverrechnung; Nachweise zu Personendaten → Dokumente und Personendaten.

### Onboarding-Unterlagen

Die Liste pflegst du unter **Einstellungen → Onboarding-Unterlagen**: Bezeichnung, Reihenfolge,
Pflicht, gilt für Studio/Büro/beide, aktiv. Nicht mehr benötigte Unterlagen **deaktivieren**
(löschen geht nicht; abgelegte Dokumente bleiben).

Beim Hochladen wählt man die Unterlage und das Ergebnis (unterschrieben oder abgelehnt).

- Freiwillige Unterlage abgelehnt → zählt als erledigt.
- **Pflichtunterlage abgelehnt** → „Klärung mit Geschäftsführung“. Nur das Personalbüro schließt
  sie (Reiter Dokumente → **Klärung schließen**, mit der Entscheidung als Vermerk).
- Ablehnung ohne Bogen (z. B. mündlich): Büro → Unterlage hochladen → **Ablehnung ohne Datei vermerken**.

### Offene Punkte

Die Seite **Offene Punkte** zeigt für alle aktiven Mitarbeiter: fehlende Onboarding-Unterlagen,
offene Klärungen, Stundenanpassungen und Stammdatenänderungen ohne Nachweis, nachzureichende
Versicherungsnummern. Filter nach Arbeitsort und Art. Leitungen sehen nur ihre Studios und nur
die Punkte ihrer Datenstufen.

### Wo das technisch steht

| Tabelle / Funktion | Zweck |
|---|---|
| `vertragsstand` | jeder Stand der Arbeitszeit mit „gültig ab“ (einzige Quelle für die Stunden) |
| `app.stand_am(dv, tag)` | welcher Stand an einem Tag gilt |
| `stunden_anpassen`, `stand_stornieren` | Stundenanpassung und Storno |
| `stammdaten_aenderung` | jede Stammdatenänderung mit altem und neuem Wert |
| `stammdaten_aendern`, `sv_nummer_nachtragen` | Änderung eintragen, Nummer nachreichen |
| `dokument` (+ Speicher `personalakte`) | Unterlagen; `dokument_ablegen` trägt eine hochgeladene Datei ein |
| `onboarding_unterlage`, `onboarding_klaerung` | Onboarding-Liste und Klärungen |
| `onboarding_stand(dv)` | Checkliste einer Person |
| `akte_kopf(dv)` | alles für die Übersicht – nur, was die Rolle sehen darf |
| `offene_punkte()`, `akte_protokoll(dv)` | Liste „Wem fehlt was“, Protokoll |

Direktes Ändern der Stunden im Dienstverhältnis oder der Stammdaten ist in der Datenbank
gesperrt. Nur du als Betreiber kannst im Notfall direkt per SQL ändern (dann ohne Nachweis –
bitte nur, wenn es wirklich nicht anders geht).

---

## 8. Die Unterschriftsmappe (iPad)

Der neue Mitarbeiter unterschreibt den Dienstzettel und die Onboarding-Unterlagen direkt am iPad.
Daraus entsteht ein PDF, das aussieht wie ein gedruckter Dienstzettel. Ein Muster liegt unter
`docs/muster/dienstzettel-muster.pdf`.

**Schrift und Sonderzeichen im PDF:** Das PDF nutzt die freie Schrift **DejaVu Sans Condensed** (sie ist
ungefähr so breit wie das frühere Helvetica). Damit erscheinen auch Namen wie „Ćirić“, „Işık“, „Олена“ oder „Αλέξανδρος“
richtig. Ein Zeichen, das die Schrift nicht kennt (z. B. ein Emoji), wird als „?“ gedruckt. Sehr lange
Wörter werden am Zeilenende mit Bindestrich getrennt. Die Schrift liegt gekürzt in
`supabase/functions/mappe/schrift.js`. Neu erzeugen nur mit `generator/schrift_kuerzen.py` (Anleitung im Kopf
des Skripts), nie von Hand. Weil die Datei zu groß ist, um sie beim Hochladen der Edge Function direkt
mitzuschicken, holt `index.ts` sie beim Hochladen von GitHub, fest auf einen Commit. Wird `schrift.js` neu
erzeugt, muss dieser Commit in `index.ts` angepasst werden; ein Test meldet es sonst. Kopfzeile, Feldbezeichnungen, Ort und Unterschriftsbeschriftung werden nicht
umbrochen; sehr lange Einträge dort können weiterhin über den Rand laufen.

### Der Ablauf

1. **Dienstzettel erfassen** (Leitung oder Büro). Danach erscheint der Knopf **Unterschriftsmappe öffnen**.
   Die Mappe ist auch später über die Akte erreichbar (Knopf **Unterschriftsmappe**).
2. **Mappe am iPad**: Zuerst der Dienstzettel, dann jede Onboarding-Unterlage. Der Mitarbeiter liest,
   setzt das Häkchen „gelesen“ und unterschreibt mit dem Finger oder Stift. Onboarding-Unterlagen kann er
   auch ablehnen („Lehnt ab“). **Später fortsetzen** ist jederzeit möglich.
3. **Arbeitgeber-Unterschrift**: Wer das Recht „Arbeitgeber-Unterschrift“ hat (Voreinstellung: Admin und
   Geschäftsführung), sieht den Menüpunkt **Zu unterschreiben**. Dringende Anmeldungen stehen oben.
   „Ansehen“ öffnet das PDF mit der Mitarbeiter-Unterschrift, „Unterschreiben“ zeigt den Dienstzettel zur
   Prüfung und das Unterschriftsfeld.
4. **Büro**: Im Reiter **Dokumente** am fertigen Dienstzettel **An Lohnverrechner übermittelt** und
   **Ausgehändigt …** (Ausdruck oder E-Mail) vermerken. Bis dahin steht es unter **Offene Punkte**.

Die Leitung sieht den vollständigen Dienstzettel (auch Entgelt) nur **bis zur Unterschrift**. Danach
nur noch „unterschrieben“.

### Fristregel und dringende Anmeldung

- Ein Dienstantritt in der Vergangenheit ist nicht möglich.
- Wird der Dienstzettel **bis zur Stichzeit** (Voreinstellung 12:00, Wiener Zeit) erfasst, ist der früheste
  Dienstantritt der **nächste Tag**. Danach liegt **ein Tag dazwischen**. Beispiel: Freitag 18:00 →
  frühestens Sonntag. Gezählt wird sekundengenau: 12:00:00 ist noch rechtzeitig, 12:00:01 nicht mehr
  (Formular und Datenbank rechnen gleich).
- Früher geht es nur mit dem Häkchen **Dringende Anmeldung** und einem **Grund**. Wer das setzt, übernimmt
  die Verantwortung. Das Büro sieht den Grund unter Offene Punkte („Dringende Anmeldung: …“).
- **„noch nicht angemeldet“** (rot) steht in Liste und Akte, bis das Büro die Anmeldebestätigung unter
  der Kategorie **Anmeldung** hochlädt. Erst dann arbeiten lassen. Gezählt wird nur eine Bestätigung der
  eigenen Firma.
- Stichzeit und Tage dazwischen änderst du unter **Einstellungen → Regeln für Dienstverträge**.

### Wenn etwas nicht stimmt

| Fall | Was tun |
|---|---|
| Fehler im Dienstzettel (z. B. Adresse falsch) | Büro: Dokumente → **Neu unterschreiben lassen** (Grund ist Pflicht). Daten korrigieren, Mappe erneut durchgehen. Der alte Dienstzettel bleibt unter „frühere Fassungen“. |
| iPad defekt, auf Papier unterschrieben | Büro: Unterlage hochladen → **Dienstzettel (Papier, Notlösung)**. Wird als „Papier (Scan)“ gekennzeichnet. |
| „Die Daten wurden geändert“ beim Unterschreiben | Jemand hat während der Unterschrift etwas geändert. Mappe neu öffnen und erneut unterschreiben. |
| „Bitte erneut unterschreiben“ | Das iPad wurde gedreht. Die Unterschrift wird dabei gelöscht, damit sie nicht verzerrt wird. |

### Textbausteine

Unter **Einstellungen → Textbausteine für den Dienstzettel** stehen die Abschnitte, die auf jedem
Dienstzettel stehen (Urlaub, Kündigung …). Eine GmbH kann einen Abschnitt abweichend festlegen. Die Texte
der Onboarding-Unterlagen bearbeitest du bei den Onboarding-Unterlagen (**Text bearbeiten**).
Die Demo-Texte sind Platzhalter – die echten Texte bitte rechtlich prüfen lassen.

### Wie das PDF entsteht (Edge Function)

Das PDF erzeugt nicht das iPad, sondern ein kleines Programm bei Supabase, die **Edge Function `mappe`**
(Code: `supabase/functions/mappe/`). Sie prüft den Zugang, holt den Inhalt aus der Datenbank, vergleicht
den **Fingerabdruck des Inhalts** (damit genau das unterschrieben wird, was angezeigt wurde), erzeugt das
PDF, legt PDF und Unterschriftsbild im privaten Speicher ab und trägt alles ein. Den geheimen
Schlüssel dafür kennt nur Supabase selbst; er steht nirgends im Code.

Jedes PDF trägt unten **Dokument-Nr.** (steht auch im Dateinamen), den **Fingerabdruck des Inhalts**
und die Seitenzahl. Nichts wird gelöscht: Jede neue Fassung ersetzt die alte, die alte bleibt erhalten.

| Tabelle / Funktion | Zweck |
|---|---|
| `mappe_inhalt(dv)` | Schritte der Mappe mit Inhalt und Fingerabdruck |
| `mappe_ablegen(…)`, `arbeitgeber_ablegen(…)` | Eintragen nach dem Unterschreiben – nur die Edge Function darf das |
| `arbeitgeber_offen()`, `arbeitgeber_inhalt(dok)` | Liste „Zu unterschreiben“ |
| `arbeitgeber_offen_hinweise()`, `app.dienstzettel_aenderungen(dok)` | Was sich seit der Mitarbeiter-Unterschrift geändert hat (Feldnamen wie „Straße“, „IBAN“, „Vertragstexte“). Nur ein Hinweis, keine Sperre. Die Anzeige in der App kommt mit dem neuen Design. |
| `dienstzettel_neu_anfordern`, `dienstzettel_vermerken`, `dienstzettel_papier` | Büro-Aktionen |
| `textbaustein` | Abschnitte des Dienstzettels, je GmbH überschreibbar |
| `unterschrift` | wer wann wo in welcher Rolle unterschrieben hat |

**Rechtlich (nur Orientierung):** Die Unterschrift am iPad ist eine einfache elektronische Signatur.
Ob das für Dienstzettel und Einwilligungen reicht, bitte von der Chefin bzw. rechtlich klären lassen.
Bis dahin nur mit erfundenen Daten testen.

---

## 9. Tests ausführen

| Art | Wie | Bestanden, wenn |
|---|---|---|
| Einheitstests und Browser-Tests | im Terminal: `tests/lauf.sh` | am Ende „Mappe-Tests bestanden“, keine Zeile mit „FEHL“ |
| Datenbank-Tests | Inhalt einer Datei aus `supabase/tests/` im Supabase **SQL Editor** ausführen | Ergebnis „alle Tests bestanden“ |

Die Datenbank-Tests legen Testpersonen nur innerhalb einer Transaktion an und machen am Ende
alles rückgängig (`rollback`). Sie brauchen einmalig die Testhilfen aus `supabase/tests/_hilfen.sql`
(Schema `testhilfe`, nur für den Betreiber nutzbar).

---

### Beispielwerte zum Testen

Nie echte Daten zum Testen verwenden. Die Prüfung rechnet nur die Prüfziffer nach; sie fragt nicht bei
Bank oder Sozialversicherung nach. Diese erfundenen Werte bestehen die Prüfung:

| Feld | Beispielwerte |
|---|---|
| Versicherungsnummer | 1238 010190, 1231 150385, 4562 220791, 7892 010600 |
| IBAN Österreich | AT61 1904 3002 3457 3201 |
| IBAN Deutschland | DE89 3704 0044 0532 0130 00 |
| IBAN Litauen (z. B. Revolut) | LT12 1000 0111 0100 1000 |
| IBAN Irland | IE29 AIBK 9311 5212 3456 78 |

Ändert man an einer gültigen IBAN oder Versicherungsnummer eine einzige Ziffer, wird sie ungültig.
Genau dafür ist die Prüfziffer da: Sie fängt Tippfehler ab.

---

## 10. Begriffe

| Begriff | Bedeutung |
|---|---|
| Migration | Eine nummerierte Änderung an der Datenbank. Die Nummern zeigen die Reihenfolge. |
| Zugriffsregel (RLS) | Regel in der Datenbank, welche Zeilen eine Person sehen oder ändern darf |
| Rolle | Was jemand im Betrieb ist (z. B. Verwaltung). Bestimmt die Rechte. |
| Mandant / Organisation | Eine Kundenfirma. Jede sieht nur ihre eigenen Daten. |
| Deploy | Eine veröffentlichte Version der App auf Netlify |
| Commit | Eine gespeicherte Änderung im Code auf GitHub |
| Platzhalter | Stelle in einer Vorlage, z. B. `{{name}}`, die automatisch befüllt wird |
| Stand | Arbeitszeit, die ab einem Datum gilt („gültig ab“) |
| Storno | Ein Eintrag gilt nicht mehr, bleibt aber sichtbar |
| Nachweis | Unterschriebenes oder amtliches Dokument, das eine Änderung belegt |
| Fingerabdruck (SHA-256) | Prüfwert einer Datei; ändert sich die Datei, ändert sich der Wert |
| Signierter Link | Zeitlich begrenzte Adresse, über die man eine private Datei öffnen kann |
| Edge Function | Kleines Programm, das bei Supabase läuft (hier: erzeugt das PDF der Unterschriftsmappe) |
| Einfache elektronische Signatur | Unterschrift auf dem Bildschirm; rechtlich schwächer als eine qualifizierte Signatur |
| Fassung | Fingerabdruck des Inhalts, der unterschrieben wurde |
| Dringende Anmeldung | Dienstantritt vor dem frühesten Termin, mit Grund und Verantwortung der Leitung |
