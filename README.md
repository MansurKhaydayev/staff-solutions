# Staff-Solutions

Personalverwaltung für Betriebe mit vielen Standorten und hoher Fluktuation:
Eintritt, Dienstverträge, Einzelvereinbarungen und digitale Unterschriften,
später Zeiterfassung, Urlaub, Krankenstand und Auswertungen.

> **Stand:** Vorführversion. Alle Daten und Demo-Vorlagen sind erfunden.
> Entwickelt privat von Mansur Khaydayev.

**Handbuch für den Betreiber:** [docs/handbuch.md](docs/handbuch.md) – Aufbau, Rollen und Rechte, häufige Aufgaben, Fehlersuche.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `supabase/migrations/` | Datenmodell (Tabellen, Zugriffsregeln, Funktionen), in der Reihenfolge der Dateinamen |
| `supabase/seed_demo.sql` | Erfundene Demo-Firma „Demo Fitness Gruppe“ (kann mehrfach ausgeführt werden) |
| `vorlagen/demo/` | Demo-Vorlagen mit Platzhaltern wie `{{name}}` |
| `generator/` | Werkzeuge zum Vorbereiten und Befüllen von Vorlagen |
| `app/` | Web-App (ohne zusätzliche Bibliotheken): Anmeldung, Dienstzettel erfassen, Mitarbeiterliste |

## App lokal starten

Die App muss über einen kleinen Webserver geöffnet werden (ein Doppelklick auf
`index.html` reicht nicht, weil der Browser sonst die Programmteile blockiert):

```bash
cd app
python3 -m http.server 8000
```

Danach im Browser `http://localhost:8000` öffnen.

## Datenmodell in Kürze

- **Mandanten:** Jede Kundenfirma (`organisation`) sieht nur ihre eigenen Daten.
- **Firmenstruktur:** Marke → Holding → GmbH → Standort (Studio oder Büro). Jeder Standort hat eine Tarifzone (z. B. Standard, Wien).
- **Personal:** Mitarbeiter, Dienstverhältnis, Entgelt mit Verlauf, Zulagen. SV-Nummer und Bankdaten liegen getrennt in `mitarbeiter_sensibel` (nur Büro).
- **Dokumente:** Vorlagen je Funktion, Dokumente mit Status (`entwurf` → `freigegeben` → `unterschrieben` → `abgeschlossen`), Unterschriften mit Ort und Zeitpunkt (unveränderbar).
- **Automatisch:** Befristungsende (`app.fristende`), GmbH aus dem Standort, Brutto aus der Brutto-Tabelle, Änderungsprotokoll (`audit_log`).
- **Rollen:** admin, geschaeftsfuehrung, hr, regionalleitung, studioleitung, mitarbeiter.

## Vorlage befüllen (Test)

```bash
python3 generator/vertrag_befuellen.py vorlagen/demo/Dienstvertrag_Servicekraft.docx generator/testdaten.json test.docx
```

Fehlt ein Wert, wird kein Dokument erzeugt.

## Tests

```bash
tests/lauf.sh          # Einheitstests und Browser-Tests (braucht Node und Playwright)
```

Die Datenbank-Tests liegen in `supabase/tests/` (Ausführen: siehe `docs/handbuch.md`, Abschnitt 9).
