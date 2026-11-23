# Unterschriftsmappe am iPad: Konzept

Stand: 24.11.2026 · Auftraggeber: Mansur Khaydayev · Projekt: Staff-Solutions

## 1. Worum es geht und warum

Ein Dienstzettel ist ohne Unterschrift nicht vollständig. Heute wird auf Papier unterschrieben,
eingescannt und in der Dropbox abgelegt. Die App erfasst den Dienstzettel bereits, legt ihn aber nur als
Entwurf an.

Die Unterschriftsmappe schließt diese Lücke. Die Regional- oder Studioleitung sitzt mit der neuen Person
am iPad. Nacheinander erscheinen der Dienstzettel und die Onboarding-Unterlagen. Die Person unterschreibt
jede Unterlage einzeln mit dem Finger oder lehnt eine Unterlage ab. Danach unterschreibt die Chefin
(Geschäftsführung) in der App für den Arbeitgeber, und das Büro übermittelt an den Lohnverrechner.
So läuft es heute schon auf Papier, und so soll es bleiben.

**Leitgedanke des Auftraggebers (gilt weiter): Alles muss nachweisbar sein.** Was im unterschriebenen
Dokument steht, muss aus der Datenbank kommen und darf vom Gerät nicht verändert werden können.

**Rechtlicher Hintergrund (Orientierung, keine Rechtsberatung; vom Lohnverrechner bzw. der AK zu prüfen):**
Die Anmeldung bei der ÖGK muss vor Arbeitsantritt erfolgen. Der Dienstzettel ist eine schriftliche
Aufzeichnung der wesentlichen Rechte und Pflichten (AVRAG § 2) und ist auszuhändigen; elektronisch ist
das unter Bedingungen möglich. Eine Unterschrift am Tablet ist eine einfache elektronische Signatur.

## 2. Ziele

1. **Unterschriftsmappe** am iPad, geöffnet aus der Akte (und direkt nach dem Speichern eines
   Dienstzettels): Dienstzettel, danach jede aktive Onboarding-Unterlage für diesen Arbeitsort,
   in der Reihenfolge der Einstellungen.
2. Je Unterlage: Text lesen, unterschreiben (Finger) oder bei Onboarding-Unterlagen „lehnt ab“
   wählen. Den Dienstzettel kann man nicht ablehnen; ohne Unterschrift bleibt er Entwurf.
3. **Das PDF entsteht auf dem Server** (Supabase Edge Function), nicht am iPad. Das iPad schickt nur
   die Unterschrift. Der Server holt die Daten selbst, erzeugt das PDF, berechnet den Fingerabdruck
   (SHA-256) und legt es in der Akte ab.
4. **Arbeitgeber-Unterschrift:** Die Geschäftsführung hat eine Liste „Zu unterschreiben“. Sie sieht
   das vom Mitarbeiter unterschriebene PDF und unterschreibt an ihrem Gerät. Es entsteht ein neues PDF
   mit beiden Unterschriften; das erste bleibt erhalten.
5. **An Lohnverrechner übermittelt:** Das Büro lädt das fertige PDF herunter, schickt es wie bisher
   und markiert „an Lohnverrechner übermittelt am …“. Die Anmeldebestätigung der ÖGK lädt das Büro wie
   bisher unter „Anmeldung“ hoch.
6. **Kopie für den Mitarbeiter:** Das fertige PDF lässt sich herunterladen bzw. drucken. Das Büro
   vermerkt „ausgehändigt am … (Ausdruck / E-Mail)“.
7. **Fristregel beim Dienstzettel** (siehe § 5), mit Ausnahme „Dringende Anmeldung“.
8. **Kein rückwirkender Dienstantritt** mehr beim Dienstzettel.
9. **„angemeldet“-Hinweis:** Neben dem Namen (Liste, Akte) steht „noch nicht angemeldet“, bis eine
   Anmeldebestätigung in der Akte liegt. Gilt für Dienstverhältnisse, die über den Dienstzettel
   angelegt werden; die spätere Bestandsübernahme markiert übernommene Personen als angemeldet.
10. Handbuch und Tests wie bisher.

## 3. Nicht-Ziele (später, eigene Projekte)

- Dienstvertrag und Einzelvereinbarungen (Leiterzulage, Sonderzahlungen, Stundenanpassung) in der
  Mappe. Dieselbe Technik wird später dafür verwendet; jetzt nur Dienstzettel und Onboarding-Unterlagen.
- Automatischer Versand an Lohnverrechner oder Mitarbeiter per E-Mail.
- Qualifizierte elektronische Signatur (Handy-Signatur / ID Austria).
- Bestandsübernahme der bestehenden rund 200 Mitarbeiter (eigene Funktion nur fürs Büro, ohne Fristregel).
- Feiertagskalender (siehe § 5).
- Echte Vorlagen-Texte und die echte Fristregel aus dem PDF der Chefin: kommen, sobald die Rechtefrage
  geklärt ist. Bis dahin Demo-Texte und einstellbare Werte.

## 4. Anti-Ziele (wäre ein Misserfolg, auch wenn es technisch funktioniert)

- Das unterschriebene PDF enthält etwas anderes als die Datenbank (z. B. ein anderes Gehalt).
- Eine Unterschrift lässt sich nachträglich entfernen, austauschen oder einem anderen Dokument zuordnen.
- Nach einer Unterschrift lässt sich der Inhalt des Dokuments still ändern.
- Jemand arbeitet, ohne dass erkennbar ist, dass er noch nicht angemeldet ist.
- Die Mappe ist am iPad mühsam (kleine Knöpfe, Unterschriftsfeld zu klein, Scrollen kaputt).

## 5. Fristregel beim Dienstzettel

Regel nach dem Gedächtnis des Auftraggebers; die genaue Fassung kommt später aus dem PDF der Chefin.
Darum sind beide Werte **in den Einstellungen änderbar**:

- **Stichzeit** (Vorgabe 12:00) und **Tage dazwischen** (Vorgabe: vor Stichzeit 0, nach Stichzeit 1).
- Übermittelt bis 12:00 → Dienstantritt frühestens am nächsten Kalendertag.
  Übermittelt nach 12:00 → frühestens am übernächsten Kalendertag.
- Beispiel: Freitag 18:00 erfasst, Dienstantritt Samstag 06:00 → abgelehnt:
  „Zu kurzfristig. Frühester Dienstantritt ist Sonntag, TT.MM. Bei dringendem Bedarf
  ‚Dringende Anmeldung‘ wählen.“
- Zeitpunkt der Übermittlung = Zeitpunkt der Mitarbeiter-Unterschrift. Geprüft wird beim Erfassen
  (mit der aktuellen Uhrzeit) und noch einmal bei der Unterschrift. Uhrzeit Europe/Vienna.
- Gezählt wird in Kalendertagen (Entscheidung von Claude, bis das PDF etwas anderes sagt; ein
  Feiertagskalender ist Nicht-Ziel).
- **Dringende Anmeldung:** Kästchen plus Pflichtfeld „Grund“. Die Leitung darf das selbst setzen
  und trägt die Verantwortung. Gespeichert werden Grund, wer und wann. Die Meldung dazu:
  „Erst arbeiten lassen, wenn ‚angemeldet‘ angezeigt wird.“ Dringende Fälle stehen in der Liste der
  Chefin ganz oben und rot, und in den offenen Punkten.
- Dienstantritt vor heute ist nicht mehr möglich (gilt für alle Rollen, auch das Büro).

## 6. Ablauf

```
Leitung erfasst Dienstzettel ──► Mappe am iPad ──► Mitarbeiter unterschreibt
   (Fristregel)                   (Dienstzettel,      je Unterlage
                                   dann Onboarding)        │
                                                           ▼
                         Server erzeugt PDF je Unterlage, legt es in der Akte ab
                                                           │
Chefin: Liste „Zu unterschreiben“ ──► unterschreibt ──► Server erzeugt PDF mit beiden Unterschriften
                                                           │
Büro: lädt herunter, schickt an Lohnverrechner, markiert „übermittelt“ und „ausgehändigt“;
      lädt später die Anmeldebestätigung hoch ──► „angemeldet“
```

**Status eines Dokuments in der Mappe:**
Dienstzettel: `entwurf` → `unterschrieben` (Mitarbeiter) → `abgeschlossen` (Arbeitgeber).
Der bestehende Status `freigegeben` wird in der Mappe nicht verwendet (Entscheidung von Claude).
Onboarding-Unterlagen brauchen keine Arbeitgeber-Unterschrift (Entscheidung von Claude:
es sind Erklärungen des Mitarbeiters); mit der Unterschrift werden sie `abgeschlossen` mit Ergebnis
„unterschrieben“, bei Ablehnung `abgelehnt` – genau wie hochgeladene Scans heute. Sie haken die
Checkliste ab; eine abgelehnte Pflichtunterlage öffnet wie bisher die Klärung.
„An Lohnverrechner übermittelt“ betrifft nur den Dienstzettel.

**Frist bei der Unterschrift:** Ist die Frist zwischen Erfassen und Unterschrift abgelaufen
(z. B. erfasst 11:00, unterschrieben 13:00), zeigt die Mappe die Fristmeldung und bietet
„Dringende Anmeldung“ mit Pflichtgrund direkt am iPad an (Entscheidung von Claude). Ohne das geht
die Unterschrift nicht.

**Papier als Notlösung:** Ist kein iPad verfügbar, kann das Büro weiterhin einen unterschriebenen
Papier-Dienstzettel als Scan hochladen. Er wird als „Papier (Scan)“ gekennzeichnet (Entscheidung von
Claude: euer heutiger Weg bleibt als Ausweg, ist aber erkennbar).

**Abbruch:** Die Mappe kann mittendrin geschlossen werden. Bereits Unterschriebenes bleibt;
beim nächsten Öffnen geht es bei der ersten offenen Unterlage weiter.

**Fehler entdeckt nach der Unterschrift** (z. B. falsche Adresse): Nichts wird überschrieben.
Das Büro korrigiert über „Änderung eintragen“ bzw. Stundenanpassung und wählt danach
„Dienstzettel neu erstellen“ (nur Büro). Dafür gelten Fristregel und „kein Dienstantritt vor heute“
nicht, weil sich der Dienstantritt nicht ändert. Der neue Dienstzettel muss wieder vom Mitarbeiter
und danach vom Arbeitgeber unterschrieben werden; der alte bleibt unter „frühere Fassungen“.

**Zurückweisen** (Büro oder Geschäftsführung, vor der Arbeitgeber-Unterschrift, mit Grund): Der
Dienstzettel wird `abgelehnt` und bleibt sichtbar. Das Büro korrigiert die Daten und erstellt ihn neu
(wie oben). Die Leitung sieht in den offenen Punkten „Dienstzettel neu unterschreiben lassen“.

## 7. Aussehen des PDF

So nah wie möglich an einem gewohnten Dienstzettel. Die Chefin entscheidet, ob es passt; darum ist
der erste Bauschritt ein **Muster-PDF** mit Demo-Daten zum Vorzeigen.

```
┌──────────────────────────────────────────────────────────┐
│ DemoFit Steiermark GmbH                  Seite 1 von 2   │
│ Musterstraße 1, 8010 Graz                                │
│                                                          │
│ DIENSTZETTEL                                             │
│ gemäß § 2 AVRAG                                          │
│                                                          │
│ Arbeitgeber      DemoFit Steiermark GmbH, Musterstraße 1 │
│ Arbeitnehmer/in  Frau Anna Berger, geb. 14.03.1995       │
│                  Probegasse 7, 8700 Leoben               │
│ Beginn           01.12.2026   Probezeit 1 Monat          │
│ Befristung       bis 28.02.2027                          │
│ Arbeitsort       DemoFit Leoben                          │
│ Tätigkeit        Servicekraft                            │
│ Arbeitszeit      20 Stunden pro Woche, 5 Tage            │
│ Entgelt          € 1.300,00 brutto monatlich …           │
│ …Textbausteine (Kündigung, Urlaub, Mitarbeitervorsorge,  │
│  Sozialversicherungsträger …)                            │
│                                                          │
│ Leoben, 24.11.2026            Graz, 25.11.2026           │
│ [Unterschrift]                [Unterschrift]             │
│ Arbeitnehmer/in               Arbeitgeber                │
│                                                          │
│ Fußzeile: Dokument-Nr. · Fingerabdruck (gekürzt)         │
└──────────────────────────────────────────────────────────┘
```

- Schrift: eine schlichte Standardschrift mit Umlauten, A4, schwarz auf weiß, gut druckbar.
- Ort und Datum je Unterschrift kommen vom System (Ort = Arbeitsort bzw. Sitz des Arbeitgebers,
  Datum = Tag der Unterschrift), so wie die Vorlagen es bisher mit `{{ort_datum_…}}` vorsehen.
- **Textbausteine** (Kündigung, Urlaub, Mitarbeitervorsorgekasse, Sozialversicherungsträger,
  Fälligkeit des Entgelts …) und die **Texte der Onboarding-Unterlagen** sind in den Einstellungen
  pflegbar. Textbausteine gelten für die ganze Firma und können je GmbH überschrieben werden
  (Entscheidung von Claude: z. B. die Mitarbeitervorsorgekasse kann je GmbH verschieden sein). Jetzt mit erfundenen Demo-Texten; die echten Texte prüft später der Lohnverrechner.
- Jede Seite trägt in der Fußzeile die Dokument-Nummer, damit lose Seiten zuordenbar sind.

## 8. Unterschreiben am iPad

- Großes Unterschriftsfeld (ganze Breite, quer gut nutzbar), Knöpfe „Löschen“ und „Unterschreiben“,
  mindestens 44 px hoch. Name der Person steht unter dem Feld.
- Vor dem Unterschreiben muss der Text einmal bis zum Ende gesehen worden sein (Scrollen) oder
  „Ich habe den Text gelesen“ angekreuzt werden (Entscheidung von Claude: Ankreuzen, weil Scrollen am
  iPad unzuverlässig erkennbar ist).
- Leere oder zu kleine Unterschrift (nur ein Punkt) wird abgewiesen.
- Die Unterschrift wird als Bild an den Server geschickt, zusammen mit dem Stand, der am iPad angezeigt
  wurde (Kennung der Fassung). Hat sich inzwischen etwas geändert, lehnt der Server ab:
  „Die Daten wurden geändert. Bitte die Mappe neu öffnen.“

## 9. Rechte

| Wer | Mappe öffnen und Mitarbeiter unterschreiben lassen | Arbeitgeber-Unterschrift | übermittelt / ausgehändigt markieren | zurückweisen |
|---|---|---|---|---|
| Studio-/Regionalleitung | für zugeordnete Studios | – | – | – |
| Personalbüro (hr) | ja | – | ja | ja |
| Geschäftsführung | ja | ja | ja | ja |
| Admin | ja | ja | ja | ja |
| Verwaltung, Buchhaltung, Mitarbeiter | – | – | – | – |

Wer die Arbeitgeber-Unterschrift setzen darf, ist in den Einstellungen je Rolle änderbar
(Vorgabe: Geschäftsführung und Admin).

**Was die Leitung in der Mappe sieht (Entscheidung des Auftraggebers):** Solange ein Dokument noch
nicht vom Mitarbeiter unterschrieben ist, zeigt die Mappe der Leitung den vollständigen Inhalt, auch
Entgelt, Geburtsdatum und Adresse; sie hat diese Daten selbst eingetragen und der Mitarbeiter muss alles
sehen, was er unterschreibt. Nach der Unterschrift gelten wieder die normalen Rechte: Das fertige
Dienstzettel-PDF liegt in der Kategorie „Vereinbarung“ und ist nur mit den Stufen Dokumente und Entgelt
sichtbar. Die Studioleitung kann es also danach nicht mehr öffnen.

## 10. Wie es gebaut wird (Ansätze)

Betrachtet wurden drei Wege:

- **A) PDF im Browser erzeugen.** Einfach, kein zusätzliches Bauteil. Abgelehnt: Das PDF und sein
  Fingerabdruck entstehen am Gerät; ein manipuliertes Gerät könnte einen anderen Inhalt hochladen.
- **B) PDF in einer Supabase Edge Function erzeugen.** Das iPad schickt nur die Unterschrift; die
  Funktion prüft die Rechte mit dem Zugang der angemeldeten Person, holt die Daten aus der Datenbank,
  erzeugt das PDF, berechnet den Fingerabdruck, legt die Datei ab und trägt Dokument und Unterschrift
  ein. **Gewählt** vom Auftraggeber: Der Inhalt des unterschriebenen Dokuments hängt nicht vom Gerät ab.
- **C) „Drucken als PDF“ im Browser.** Ausgeschlossen: am iPad nicht steuerbar, nicht automatisch
  speicherbar.

Festgelegt:
- Die Edge Function ist der einzige Weg, ein Mappen-PDF und eine Unterschrift anzulegen. Sie prüft die
  Rechte über die Datenbank (wie die bisherigen Funktionen), nicht selbst.
- Die Unterschriftsbilder werden mit abgelegt (privat), damit das PDF später nachvollziehbar ist.
- Unterschriften werden nie geändert oder gelöscht (Tabelle `unterschrift`, wie bisher nur einfügen).
- Der geheime Schlüssel der Datenbank liegt nur in der Edge Function (von Supabase bereitgestellt),
  nie im Code auf GitHub.

## 11. Was dem Bauenden überlassen bleibt

- Aufteilung der Edge Function, PDF-Bibliothek (Hauptsache: Umlaute, eingebettete Bilder, A4), Layout-Details.
- Wie die „Fassung“ eines Dokuments erkannt wird (z. B. Fingerabdruck der Daten).
- Darstellung der Liste „Zu unterschreiben“ und der Mappe im Rahmen des bestehenden Stils.
- Demo-Texte für Textbausteine und Onboarding-Unterlagen.
