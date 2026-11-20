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
| `app/einstellungen.js` | Die Einstellungen-Seite |
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

---

## 7. Begriffe

| Begriff | Bedeutung |
|---|---|
| Migration | Eine nummerierte Änderung an der Datenbank. Die Nummern zeigen die Reihenfolge. |
| Zugriffsregel (RLS) | Regel in der Datenbank, welche Zeilen eine Person sehen oder ändern darf |
| Rolle | Was jemand im Betrieb ist (z. B. Verwaltung). Bestimmt die Rechte. |
| Mandant / Organisation | Eine Kundenfirma. Jede sieht nur ihre eigenen Daten. |
| Deploy | Eine veröffentlichte Version der App auf Netlify |
| Commit | Eine gespeicherte Änderung im Code auf GitHub |
| Platzhalter | Stelle in einer Vorlage, z. B. `{{name}}`, die automatisch befüllt wird |
