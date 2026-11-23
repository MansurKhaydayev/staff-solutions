import { test } from "node:test";
import assert from "node:assert/strict";
import { arbeitszeitPruefen, dienstzettelPruefen } from "../../app/pruefungen.js";

const regeln = { vollzeit_stunden: 40, max_stunden_tag: 10, geringfuegig_grenze: 551.10 };
const w = (beschaeftigungsart, wochenstunden, arbeitstage, netto) =>
  ({ beschaeftigungsart, wochenstunden: String(wochenstunden), arbeitstage: String(arbeitstage), netto: String(netto) });

test("arbeitszeitPruefen: gültige Vollzeit ohne Meldung", () => {
  assert.deepEqual(arbeitszeitPruefen(w("vollzeit", 40, 5, 1500), regeln), {});
});
test("arbeitszeitPruefen: 40 Stunden an 1 Tag", () => {
  assert.match(arbeitszeitPruefen(w("teilzeit", 40, 1, 1000), regeln).wochenstunden,
    /40 Stunden an 1 Tag sind 40 Stunden pro Tag/);
});
test("arbeitszeitPruefen: Vollzeit mit 30 Stunden", () => {
  assert.match(arbeitszeitPruefen(w("vollzeit", 30, 5, 1000), regeln).wochenstunden, /Vollzeit sind 40 Stunden/);
});
test("arbeitszeitPruefen: geringfügig über der Grenze", () => {
  assert.match(arbeitszeitPruefen(w("geringfuegig", 8, 2, 600), regeln).netto, /551,10/);
});
test("dienstzettelPruefen nutzt dieselbe Meldung", () => {
  const f = dienstzettelPruefen({ ...w("teilzeit", 40, 1, 1000), leiterzulage: "" }, regeln, {});
  assert.match(f.wochenstunden, /40 Stunden an 1 Tag sind 40 Stunden pro Tag/);
});

import { stundenanpassungPruefen } from "../../app/pruefungen.js";
const sa = (gueltig_ab, art = "teilzeit", std = 25, tage = 5, netto = 1000) =>
  ({ gueltig_ab, beschaeftigungsart: art, wochenstunden: String(std), arbeitstage: String(tage), netto: String(netto) });
const kontext = { eintritt: "2026-10-01", letzterStand: "2026-12-01", austritt: null };

test("stundenanpassungPruefen: gültige Anpassung", () => {
  assert.deepEqual(stundenanpassungPruefen(sa("2027-01-01"), regeln, kontext), {});
});
test("stundenanpassungPruefen: vor dem Dienstantritt", () => {
  assert.match(stundenanpassungPruefen(sa("2026-09-30"), regeln, kontext).gueltig_ab, /Dienstantritt/);
});
test("stundenanpassungPruefen: am Tag des letzten Stands", () => {
  assert.match(stundenanpassungPruefen(sa("2026-12-01"), regeln, kontext).gueltig_ab, /schon einen Stand/);
});
test("stundenanpassungPruefen: vor dem letzten Stand", () => {
  assert.match(stundenanpassungPruefen(sa("2026-11-15"), regeln, kontext).gueltig_ab, /späteren Stand/);
});
test("stundenanpassungPruefen: nach dem Austritt", () => {
  assert.match(stundenanpassungPruefen(sa("2027-01-01"), regeln, { ...kontext, austritt: "2026-12-31" }).gueltig_ab, /Austritt/);
});
test("stundenanpassungPruefen: 40 Stunden an 1 Tag", () => {
  assert.match(stundenanpassungPruefen(sa("2027-01-01", "teilzeit", 40, 1), regeln, kontext).wochenstunden, /pro Tag/);
});
test("stundenanpassungPruefen: Datum fehlt", () => {
  assert.match(stundenanpassungPruefen(sa(""), regeln, kontext).gueltig_ab, /ab wann/);
});

import { stammdatenFeldPruefen } from "../../app/pruefungen.js";
test("stammdatenFeldPruefen: PLZ zu kurz", () => {
  assert.equal(stammdatenFeldPruefen("plz", "80"), "4 oder 5 Ziffern.");
});
test("stammdatenFeldPruefen: gültige IBAN mit Leerzeichen", () => {
  assert.equal(stammdatenFeldPruefen("iban", "AT61 1904 3002 3457 3201"), null);
});
test("stammdatenFeldPruefen: falsche Prüfziffer der Versicherungsnummer", () => {
  assert.match(stammdatenFeldPruefen("sv_nummer", "1238010191"), /Prüfziffer/);
});
test("stammdatenFeldPruefen: leeres Pflichtfeld, BIC darf leer sein", () => {
  assert.match(stammdatenFeldPruefen("nachname", " "), /leer/);
  assert.equal(stammdatenFeldPruefen("bic", ""), null);
});
test("dienstzettelPruefen meldet PLZ weiterhin gleich", () => {
  assert.equal(dienstzettelPruefen({ plz: "80", leiterzulage: "", wochenstunden: "", arbeitstage: "", netto: "" }, regeln, {}).plz,
    "4 oder 5 Ziffern.");
});
