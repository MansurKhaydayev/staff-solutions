# Austritt, Storno und Mail-Knöpfe: Konzept

Stand: 25.11.2026 · Auftraggeber: Mansur Khaydayev · Projekt: Staff-Solutions · **Entwurf zur Freigabe**

## 1. Worum es geht und warum

Heute kann die App einen Mitarbeiter anlegen, unterschreiben lassen und als „angemeldet“ führen.
Das Ende eines Dienstverhältnisses kennt sie nicht:

- Ein Austrittsdatum lässt sich nicht eintragen.
- Eine hochgeladene „Abmeldung“ ändert nichts am Status.
- Tritt jemand nach der Anmeldung gar nicht an, gibt es keinen Storno der Anmeldung.

Außerdem läuft die Übermittlung an die Lohnverrechner per Mail. Bei hoher Fluktuation sind das viele
einzelne Mails. Dieses Projekt schließt diese Lücken.

**Leitgedanke (gilt weiter): Alles muss nachweisbar sein.** Nichts wird gelöscht. Jede Meldung, jede
Bestätigung und jede Korrektur bleibt mit Person, Zeitpunkt und Grund sichtbar.

**Rechtlicher Hintergrund (Orientierung, keine Rechtsberatung; vom Lohnverrechner zu prüfen):**

- Die Abmeldung bei der ÖGK muss **binnen 7 Tagen nach Ende der Pflichtversicherung** erfolgen
  (§ 33 ASVG). Der Mitarbeiter bekommt unverzüglich eine Abschrift der Abmeldung.
- Das Ende der Pflichtversicherung ist nicht immer der letzte Arbeitstag. Eine Urlaubsersatzleistung
  verlängert zum Beispiel die Pflichtversicherung. Die App rechnet deshalb nur eine **Orientierungsfrist**
  (letzter Arbeitstag + 7 Tage). Das genaue Ende kennt der Lohnverrechner.
- Tritt jemand nach der Anmeldung **nicht an**, muss die Anmeldung **storniert** werden.

## 2. Ziele

1. **Austritt melden (Leitung):** In der Akte „Austritt melden“: letzter Arbeitstag, Art des Austritts,
   Notiz. Die Akte zeigt danach „Austritt gemeldet“.
2. **Nicht angetreten melden (Leitung):** In der Akte „Nicht angetreten“ mit **Pflicht-Grund**.
3. **Bestätigen (Büro):** Das Büro sieht die Meldung in „Offene Punkte“ und bestätigt sie. **Erst dann
   gilt das Datum.** Vorher zählt der Austritt nirgends, auch nicht in den Kennzahlen der Startseite.
4. **Abmeldung:** Nach der Bestätigung entsteht der offene Punkt „Abmeldung übermitteln bis
   [letzter Arbeitstag + 7 Tage]“. Ist die Abmeldebestätigung (Kategorie „Abmeldung“) hochgeladen, steht
   der Mitarbeiter auf **abgemeldet**. Danach „Abschrift ausgehändigt“ vermerken.
5. **Storno:** Ist jemand nicht angetreten und schon angemeldet, zeigt die App **„Storno ausständig“**,
   bis die Storno-Bestätigung (neue Kategorie „Storno“) hochgeladen ist. Danach **Anmeldung storniert**.
   War er noch nicht angemeldet, ist er nach der Bestätigung direkt **nicht angetreten**.
6. **Raus aus den aktiven Listen:** Ausgetretene (nach dem letzten Arbeitstag) und Nicht-Angetretene
   verschwinden aus der Mitarbeiterliste, der Unterschriftsmappe und den offenen Punkten. Die Akte bleibt
   erhalten und ist über „auch ehemalige anzeigen“ erreichbar.
7. **Korrigieren statt Löschen:** Eine bestätigte Meldung kann nur das Büro korrigieren, mit Grund. Die alte
   Fassung bleibt durchgestrichen sichtbar. War die Abmeldung schon übermittelt, erinnert die App daran,
   dass der Lohnverrechner die Korrektur ebenfalls braucht.
8. **Sammelmail an die Lohnverrechner:** Eine Liste „An Lohnverrechner übermitteln“ (siehe § 6).
9. **Filter für die Verwaltung:** In der Mitarbeiterliste ein Filter „Ein- und Austritte“ mit Zeitraum.
   Die Verwaltung sieht damit selbst, wer neu ist und wer gegangen ist, ohne Gehalt oder Bankdaten.
   Statt eines Wochenberichts per Mail.
10. **Status im Verzeichnis:** `mitarbeiter_verzeichnis()` liefert eine Spalte `status` (siehe § 4). Die
    Startseite filtert damit „nicht angetreten“ aus ihren Zählungen.
11. Handbuch und Tests wie bisher.

## 3. Nicht-Ziele (später oder bewusst nicht)

- **Automatischer Mail-Versand** (weiterer Anbieter mit Personaldaten, erst nach der rechtlichen Klärung).
- **Mail von der Leitung ans Büro:** Die Meldung erscheint sofort in Akte und „Offene Punkte“. Eine
  zusätzliche Mail würde das Büro nur mit Mails überschwemmen.
- **Wochenbericht an die Verwaltung per Mail:** Die Verwaltung schaut selbst im Filter nach (Ziel 9).
- **Download der gesamten Auswertung für die Geschäftsleitung:** baut das Projekt „Startseite mit Kennzahlen“.
- ZIP-Datei mit allen Anhängen (manche Mailprogramme blockieren ZIP).
- Direkte Meldung an die ÖGK (ELDA), Endabrechnung, Berechnung der Urlaubsersatzleistung.
- **Wiedereintritt** derselben Person: läuft wie bisher über einen neuen Dienstzettel (neues Dienstverhältnis).

## 4. Anti-Ziele (wäre ein Misserfolg, auch wenn es technisch funktioniert)

- Ein bloß **gemeldeter** Austritt gilt schon als Austritt (Status, Kennzahlen, Listen).
- Eine Meldung, ein Datum oder eine Bestätigung lässt sich löschen oder still überschreiben.
- Eine Leitung meldet für ein Studio, für das sie nicht zuständig ist.
- Ein Mitarbeiter ist ausgetreten, aber die Abmeldefrist läuft ab, ohne dass es jemand sieht.
- Jemand ist nicht angetreten, aber angemeldet, und der Storno wird vergessen.
- In der Mail steht Gehalt, Versicherungsnummer oder Bank im **Text** (das gehört nur ins PDF).
- Nach dem Speichern weiß man nicht, wo das PDF liegt.

## 5. Ablauf und Zustände

### Zustände eines Dienstverhältnisses (Spalte `status`)

| Status | Bedeutung | Anzeige |
|---|---|---|
| `aktiv` | normal beschäftigt (auch „noch nicht angemeldet“ wie bisher) | – |
| `austritt_gemeldet` | Leitung hat gemeldet, Büro hat noch nicht bestätigt | gelb „Austritt gemeldet“ |
| `austritt_bestaetigt` | Büro hat bestätigt, Abmeldebestätigung fehlt noch | „Austritt am TT.MM.“, rot ab Fristablauf |
| `abgemeldet` | Abmeldebestätigung liegt vor | grau „abgemeldet“ |
| `nicht_angetreten_gemeldet` | Leitung hat „nicht angetreten“ gemeldet, Büro hat noch nicht bestätigt | gelb |
| `storno_ausstaendig` | bestätigt, war schon angemeldet, Storno-Bestätigung fehlt | rot „Storno ausständig“ |
| `nicht_angetreten` | bestätigt, Storno liegt vor oder war nie angemeldet | grau „nicht angetreten“ |

Der Status wird **berechnet** (aus Meldung, Austrittsdatum und Dokumenten), nicht gespeichert. Er kann
deshalb nie „vergessen“ werden.

### Austritt

1. **Leitung** (nur für Studios in ihrer Reichweite) meldet: letzter Arbeitstag, Art, Notiz.
   Arten (in den Einstellungen änderbar): Lösung in der Probezeit, Kündigung durch Arbeitnehmer,
   Kündigung durch Arbeitgeber, einvernehmliche Auflösung, Ende der Befristung, Entlassung,
   vorzeitiger Austritt, Sonstiges.
2. Akte und Liste zeigen „Austritt gemeldet“. Offener Punkt fürs Büro: „Austritt bestätigen“.
3. **Büro** bestätigt (Datum und Art können dabei angepasst werden, die Abweichung wird vermerkt).
   Erst jetzt wird `dienstverhaeltnis.austritt` gesetzt.
4. Offener Punkt: „Abmeldung übermitteln bis TT.MM.“ (letzter Arbeitstag + 7 Tage, ab Fristablauf rot).
5. Das Büro übermittelt (Sammelmail, § 6) und lädt die Abmeldebestätigung hoch → **abgemeldet**.
6. Offener Punkt: „Abschrift der Abmeldung aushändigen“ → Vermerk „ausgehändigt am … (Ausdruck/E-Mail)“.

Das **Büro** kann einen Austritt auch selbst melden und im selben Schritt bestätigen (z. B. bei einer
Kündigung, die direkt im Büro ankommt).

### Nicht angetreten

1. **Leitung** meldet „Nicht angetreten“ mit Pflicht-Grund. Möglich ab dem geplanten Dienstantritt.
   Vorher reicht ein Hinweis ans Büro, der Dienstzettel kann dann wie bisher neu angefordert werden.
2. **Büro** bestätigt.
3. War er schon angemeldet → **Storno ausständig**, bis die Storno-Bestätigung hochgeladen ist.
   Sonst → direkt **nicht angetreten**.
4. Offene Punkte zum Onboarding und zur Mappe für diese Person entfallen. Die Akte bleibt.
5. In den Kennzahlen zählt er weder als Eintritt noch als Austritt. `austritt` bleibt leer.

### Korrigieren

- Nur Büro, nur mit Grund. Es entsteht eine neue Fassung der Meldung, die alte zeigt auf die neue
  (`ersetzt_durch`), wie bei den Dokumenten.
- Eine Korrektur kann auch „Austritt zurücknehmen“ sein (Mitarbeiter bleibt doch). Dann ist er wieder `aktiv`.
- War schon übermittelt, kommt die Korrektur in die nächste Sammelmail an den Lohnverrechner.

## 6. Sammelmail an die Lohnverrechner

**Zuordnung:** Jede GmbH hat ihren Lohnverrechner (Tabelle `lohnverrechner`, gibt es schon). In der
echten Firma sind es drei. In der Demo bleibt es bei erfundenen Namen und Adressen auf `@demo.invalid`.

**Liste „An Lohnverrechner übermitteln“** (eigener Bereich in „Offene Punkte“, nur Büro), getrennt nach
Lohnverrechner:

| Art | Wann steht sie auf der Liste | Anhang |
|---|---|---|
| Anmeldung | Dienstzettel fertig unterschrieben, noch nicht übermittelt | das unterschriebene PDF (gibt es schon) |
| Abmeldung | Austritt bestätigt, noch nicht übermittelt | PDF „Austrittsmeldung“ (neu) |
| Storno | Nicht angetreten bestätigt, war angemeldet, noch nicht übermittelt | PDF „Storno-Meldung“ (neu) |
| Korrektur | eine schon übermittelte Meldung wurde korrigiert | PDF mit alt und neu (neu) |

**Ablauf:**
1. Das Büro hakt die Fälle an (Voreinstellung: alle offenen eines Lohnverrechners) und klickt
   **„PDFs speichern und Mail öffnen“**.
2. Die App speichert die PDFs nacheinander. Der Browser fragt beim ersten Mal eventuell, ob die Seite
   mehrere Dateien speichern darf.
3. Die App zeigt danach eine Liste der gespeicherten Dateien mit **genauem Dateinamen** und wo sie
   liegen: „im Ordner Downloads“ (am iPad: Dateien-App → Downloads). Die Dateinamen beginnen gleich,
   damit man sie beim Anhängen leicht findet, z. B.
   `2026-11-25_Lohnbuero-Demo_Anmeldung_Muster-Max.pdf`.
4. Das Mailprogramm öffnet sich mit Empfänger, Betreff („Staff-Solutions: 3 Anmeldungen, 1 Abmeldung,
   25.11.2026“) und Text. Im Text stehen **nur Namen, Art und Datum**, keine Versicherungsnummer, kein
   Gehalt, keine Bank.
5. Das Büro hängt die PDFs an und sendet selbst.
6. Die App fragt **„Gesendet?“**. „Ja“ → alle Fälle bekommen „übermittelt am … von …“. „Nein“ → nichts
   ändert sich, die Fälle bleiben auf der Liste.
7. Ein Einzelfall ist einfach eine Sammelmail mit einem Fall. Der bisherige Knopf „An Lohnverrechner
   übermittelt“ in der Akte bleibt für Fälle, die auf anderem Weg geschickt wurden.

**Die neuen PDFs** (Austrittsmeldung, Storno, Korrektur) erzeugt die Edge Function `mappe` im selben Stil
wie den Dienstzettel, mit Dokument-Nr. und Fingerabdruck. Sie werden in der Akte abgelegt. So ist
später nachweisbar, was genau übermittelt wurde.

**Grenze:** Ein Mail-Knopf (`mailto:`) kann keine Dateien anhängen und nur kurzen Text übergeben.
Bei sehr vielen Fällen (über ca. 30) kürzt die App die Namensliste im Text („… und 12 weitere, siehe
Anhänge“).

## 7. Rechte

Es entstehen **keine neuen fest einprogrammierten Rollenlisten** (passt zum Projekt „Rollen verallgemeinern“).

| Aktion | Wer | Technisch |
|---|---|---|
| Austritt / nicht angetreten melden | wer Mitarbeiter **anlegen** darf, in seiner Reichweite | Recht „Anlegen“ aus `rollen_recht` + `app.in_reichweite(dv)` |
| Bestätigen, korrigieren, übermitteln, Bestätigungen hochladen | Büro | `app.ist_buero()` |
| Status und Austrittsdatum sehen | jeder mit Zugang (Stufe Verzeichnis) | wie Name und Dienstantritt |
| Art, Notiz, Grund sehen | Stufe Personendaten | `app.sieht('personendaten', standort)` |
| Austrittsmeldung-, Storno-PDF | Kategorie „Abmeldung“ bzw. „Storno“: Dokumente + Lohnverrechnung | wie bisher bei „Abmeldung“ |

## 8. Datenbank (Überblick, Details im Plan)

- Neue Tabelle `austritt_meldung`: Dienstverhältnis, Art (`austritt` / `nicht_angetreten`), letzter Arbeitstag,
  Austrittsart, Notiz bzw. Grund, gemeldet von/am, bestätigt von/am, Abweichung bei Bestätigung,
  `ersetzt_durch` und Korrekturgrund, `uebermittelt_am/von`. Schreiben nur über Funktionen, Löschen gesperrt.
- Neue Dokument-Kategorie `storno` (sichtbar wie „Abmeldung“).
- Neue Tabelle `sammelversand`: Lohnverrechner, Zeitpunkt, wer, welche Fälle. Für das Protokoll.
- Einstellungen: Austrittsarten, Abmeldefrist in Tagen (Vorgabe 7), Mail-Adresse des Personalbüros
  (Demo-Adresse, vorerst nur für einen Knopf „Rückfrage ans Büro“ in der Akte).
- Funktionen (Namen vorläufig): `austritt_melden`, `austritt_bestaetigen`, `austritt_korrigieren`,
  `uebermittlung_offen`, `uebermittlung_vermerken`, `app.dv_status(dv)`.
- `mitarbeiter_verzeichnis()`, `akte_kopf()` und `offene_punkte()` bekommen den Status bzw. die neuen Punkte.
- Alles in neuen Migrationen ab 026, alte Migrationen bleiben unverändert.

## 9. Oberfläche

- **Akte:** Knöpfe „Austritt melden“ und „Nicht angetreten“, Statusanzeige im Kopf, Verlauf der Meldungen
  (mit durchgestrichenen alten Fassungen).
- **Offene Punkte:** neue Punkte (bestätigen, Abmeldefrist, Storno, Abschrift) und der Bereich
  „An Lohnverrechner übermitteln“.
- **Mitarbeiterliste:** Filter „aktiv“ (Voreinstellung), „Ein- und Austritte“ mit Zeitraum, „auch ehemalige“.
- **Einstellungen:** Austrittsarten, Abmeldefrist, Mail-Adresse Personalbüro, Mail-Adresse je Lohnverrechner.
- **Gebaut wird die Oberfläche erst, wenn das neue Design (Blau/Türkis) steht.** Die Datenbank kann vorher
  entstehen.

## 10. Tests

- Datenbank: `supabase/tests/14_austritt.sql` (je Rolle: melden, bestätigen, Reichweite, Status, Frist,
  Storno, Korrektur, Löschsperre, Verzeichnis-Status), in `begin … rollback`.
- Edge Function: neue PDFs in Node über `ablauf.js` / `pdf.js` testen.
- App: Einheitstests für Mail-Text und Dateinamen (`tests/unit/`), Browsertests für Melden, Bestätigen
  und Sammelmail (`tests/ui/`).

## 11. Noch zu entscheiden (Vorschlag in Klammern)

1. Darf das Büro einen Austritt selbst melden und gleich bestätigen? (**ja**)
2. „Nicht angetreten“ erst ab dem geplanten Dienstantritt? (**ja**, vorher Dienstzettel neu anfordern)
3. Austrittsarten wie in § 5? (**ja**, in den Einstellungen änderbar)
4. Austrittsdatum für alle sichtbar (Stufe Verzeichnis), Art und Grund nur mit Personendaten? (**ja**)
