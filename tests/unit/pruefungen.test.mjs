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
