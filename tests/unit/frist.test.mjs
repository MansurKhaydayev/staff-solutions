import { test } from "node:test";
import assert from "node:assert/strict";
import { fruehesterDienstantritt, fristMeldung } from "../../app/frist.js";

const regeln = { anmeldung_stichzeit: "12:00:00", tage_dazwischen_vor: 0, tage_dazwischen_nach: 1 };
const wien = (iso) => new Date(iso);  // Zeitpunkte mit Zeitzone angeben (+01:00 = Wiener Winterzeit)

test("Freitag 18:00 → frühestens Sonntag", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-27T18:00:00+01:00"), regeln), "2026-11-29");
});
test("Mittwoch 11:59 und 12:00 → Donnerstag", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T11:59:00+01:00"), regeln), "2026-11-26");
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:00+01:00"), regeln), "2026-11-26");
});
test("Mittwoch 12:01 → Freitag", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:01:00+01:00"), regeln), "2026-11-27");
});
test("23:30 Wiener Zeit zählt zum Wiener Datum", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-30T22:30:00Z"), regeln), "2026-12-02");
});
test("andere Einstellungen wirken", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T11:00:00+01:00"),
    { anmeldung_stichzeit: "10:00:00", tage_dazwischen_vor: 0, tage_dazwischen_nach: 2 }), "2026-11-28");
});
test("Meldung mit Wochentag und Datum", () => {
  assert.equal(fristMeldung("2026-11-29"),
    "Zu kurzfristig. Frühester Dienstantritt ist Sonntag, 29.11.2026. Bei dringendem Bedarf „Dringende Anmeldung“ wählen.");
});
test("sekundengenau wie die Datenbank: 12:00:30 ist nach der Stichzeit", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:30+01:00"), regeln), "2026-11-27");
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:01+01:00"), regeln), "2026-11-27");
});
test("11:59:59 und 12:00:00 → nächster Tag", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T11:59:59+01:00"), regeln), "2026-11-26");
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:00+01:00"), regeln), "2026-11-26");
});
test("Sommerzeit: 12:00:30 Wiener Zeit ist nach der Stichzeit", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-07-01T12:00:30+02:00"), regeln), "2026-07-03");
});
test("Stichzeit mit Sekunden wird genau gelesen", () => {
  const r = { ...regeln, anmeldung_stichzeit: "11:30:15" };
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T11:30:15+01:00"), r), "2026-11-26");
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T11:30:16+01:00"), r), "2026-11-27");
});
test("Stichzeit ohne Sekunden („12:00“) gilt bis 12:00:00", () => {
  const r = { ...regeln, anmeldung_stichzeit: "12:00" };
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:00+01:00"), r), "2026-11-26");
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:59+01:00"), r), "2026-11-27");
});
test("auch Bruchteile einer Sekunde nach 12:00:00 sind nach der Stichzeit (wie now() in der Datenbank)", () => {
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:00.000+01:00"), regeln), "2026-11-26");
  assert.equal(fruehesterDienstantritt(wien("2026-11-25T12:00:00.300+01:00"), regeln), "2026-11-27");
});
