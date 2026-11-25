import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monatsEnde, imDienst, bestandNach, monatsZahlen, jahresZahlen, zwoelfMonate, fruehfluktuation,
  verteilung, hinweise, vollzeitaequivalente, betriebszugehoerigkeit, personalkosten, monatPlus,
} from "../../app/kennzahlen.js";

// Kleine Hilfe: ein Dienstverhältnis, wie es mitarbeiter_verzeichnis liefert
let nr = 0;
const dv = (eintritt, austritt = null, mehr = {}) => ({
  dienstverhaeltnis_id: `d${++nr}`, vorname: "Demo", nachname: `Person ${nr}`, standort_id: "s1", funktion_id: "f1",
  beschaeftigungsart: "teilzeit", wochenstunden: 20, befristet_bis: null, angemeldet: true, eintritt, austritt, ...mehr,
});

test("Monatsende und Monate weiterzählen", () => {
  assert.equal(monatsEnde(2026, 2), "2026-02-28");
  assert.equal(monatsEnde(2028, 2), "2028-02-29");
  assert.equal(monatsEnde(2026, 12), "2026-12-31");
  assert.deepEqual(monatPlus(2026, 1, -1), { jahr: 2025, monat: 12 });
  assert.deepEqual(monatPlus(2026, 11, 3), { jahr: 2027, monat: 2 });
});

test("im Dienst: Eintritt bis Austritt (letzter Arbeitstag zählt noch)", () => {
  const z = dv("2026-03-01", "2026-03-31");
  assert.equal(imDienst(z, "2026-02-28"), false);
  assert.equal(imDienst(z, "2026-03-01"), true);
  assert.equal(imDienst(z, "2026-03-31"), true);
  assert.equal(imDienst(z, "2026-04-01"), false);
  // Bestand nach einem Tag: wer an diesem Tag austritt, ist danach nicht mehr da
  assert.equal(bestandNach([z], "2026-03-31"), 0);
  assert.equal(bestandNach([z], "2026-03-30"), 1);
});

test("Monatszahlen: Eintritte, Austritte, Stand und Fluktuation", () => {
  const z = [
    dv("2025-01-01"), dv("2025-01-01"), dv("2025-01-01"), dv("2025-01-01"),   // 4 Stammkräfte
    dv("2025-06-01", "2026-03-15"),                                            // tritt im März aus
    dv("2026-03-10"),                                                          // tritt im März ein
    dv("2026-03-02", "2026-03-20"),                                            // rein und raus im März
  ];
  const m = monatsZahlen(z, 2026, 3, "2026-11-25");
  assert.equal(m.eintritte, 2);
  assert.equal(m.austritte, 2);
  assert.equal(m.standAnfang, 5);
  assert.equal(m.standEnde, 5);
  // 2 Austritte / Ø (5 + 5) / 2 = 40 %
  assert.equal(m.fluktuation, 40);
});

test("laufender Monat zählt nur bis heute, Geplantes kommt extra", () => {
  const z = [dv("2025-01-01"), dv("2026-11-03"), dv("2026-11-28"), dv("2025-01-01", "2026-11-30")];
  const m = monatsZahlen(z, 2026, 11, "2026-11-25");
  assert.equal(m.eintritte, 1);
  assert.equal(m.eintritteGeplant, 1);
  assert.equal(m.austritte, 0);
  assert.equal(m.austritteGeplant, 1);
  assert.equal(m.standEnde, 3);          // Stand heute
  assert.equal(m.laufend, true);
});

test("Monat in der Zukunft hat keine Zahlen", () => {
  const m = monatsZahlen([dv("2025-01-01")], 2026, 12, "2026-11-25");
  assert.equal(m.zukunft, true);
  assert.equal(m.fluktuation, null);
});

test("ohne Personal keine Fluktuation (kein Teilen durch 0)", () => {
  assert.equal(monatsZahlen([], 2026, 3, "2026-11-25").fluktuation, null);
});

test("Jahreszahlen: 12 Monate, Summe bis heute und Jahresfluktuation", () => {
  const z = [];
  for (let i = 0; i < 10; i++) z.push(dv("2025-01-01"));
  z.push(dv("2025-01-01", "2026-02-10"), dv("2026-05-01"));
  const j = jahresZahlen(z, 2026, "2026-11-25");
  assert.equal(j.monate.length, 12);
  assert.equal(j.monate[11].zukunft, true);
  assert.equal(j.eintritte, 1);
  assert.equal(j.austritte, 1);
  // Stand Monatsende Jan–Nov (November: Stand heute): 11, 10, 10, 10, dann 7 × 11 → Ø 118/11
  assert.equal(j.durchschnitt, 118 / 11);
  assert.equal(Math.round(j.fluktuation * 100) / 100, 9.32);   // 1 / 10,73 × 100
});

test("Fluktuation der letzten 12 Monate geht über den Jahreswechsel", () => {
  const z = [];
  for (let i = 0; i < 9; i++) z.push(dv("2024-01-01"));
  z.push(dv("2024-01-01", "2025-12-15"));   // im Fenster Dez 2025 – Nov 2026
  z.push(dv("2024-01-01", "2025-11-15"));   // knapp davor
  const f = zwoelfMonate(z, 2026, 11, "2026-11-25");
  assert.equal(f.austritte, 1);
  assert.equal(f.von, "2025-12-01");
  assert.equal(f.bis, "2026-11-25");
  assert.equal(Math.round(f.fluktuation * 10) / 10, 11.1);   // 1 / 9 × 100
});

test("Frühfluktuation: Austritt in der Probezeit", () => {
  const z = [
    dv("2026-03-01", "2026-03-31"),   // genau 1 Monat → noch in der Probezeit
    dv("2026-03-01", "2026-04-01"),   // danach
    dv("2026-01-15", "2026-02-14"),   // in der Probezeit
    dv("2025-01-01", "2026-06-30"),
  ];
  const f = fruehfluktuation(z, 1, "2026-01-01", "2026-12-31");
  assert.equal(f.austritte, 4);
  assert.equal(f.inProbezeit, 2);
  assert.equal(f.anteil, 50);
  assert.equal(fruehfluktuation([], 1, "2026-01-01", "2026-12-31").anteil, null);
});

test("Verteilung zählt nur, wer heute im Dienst ist, größte zuerst", () => {
  const z = [dv("2025-01-01", null, { standort_id: "a" }), dv("2025-01-01", null, { standort_id: "b" }),
    dv("2025-01-01", null, { standort_id: "b" }), dv("2025-01-01", "2026-01-01", { standort_id: "a" }),
    dv("2027-01-01", null, { standort_id: "a" })];
  assert.deepEqual(verteilung(z, "standort_id", "2026-11-25"), [{ wert: "b", anzahl: 2 }, { wert: "a", anzahl: 1 }]);
  // ohne Recht auf Personendaten kommt die Beschäftigungsart leer: dann keine Verteilung
  assert.deepEqual(verteilung([dv("2025-01-01", null, { beschaeftigungsart: null })], "beschaeftigungsart", "2026-11-25"), []);
});

test("Hinweise: Befristung, Probezeit, nicht angemeldet, kommende Antritte", () => {
  const heute = "2026-11-25";
  const z = [
    dv("2026-06-01", null, { befristet_bis: "2026-12-10" }),   // Befristung endet in 15 Tagen
    dv("2026-06-01", null, { befristet_bis: "2027-06-01" }),   // noch lang hin
    dv("2026-11-10", null),                                    // Probezeit endet am 09.12.
    dv("2026-11-20", null, { angemeldet: false }),             // nicht angemeldet
    dv("2026-12-01", null, { angemeldet: false }),             // kommt erst, auch noch nicht angemeldet
    dv("2026-01-01", "2026-05-01", { angemeldet: false }),     // längst weg: kein Hinweis
  ];
  const h = hinweise(z, heute, 1, 30);
  assert.deepEqual(h.befristung.map((x) => x.bis), ["2026-12-10"]);
  assert.deepEqual(h.probezeit.map((x) => x.bis), ["2026-12-09", "2026-12-19"]);
  assert.equal(h.nichtAngemeldet.length, 2);
  assert.deepEqual(h.kommend.map((x) => x.eintritt), ["2026-12-01"]);
});

test("Vollzeitäquivalente und Betriebszugehörigkeit", () => {
  const z = [dv("2024-11-25", null, { wochenstunden: 40 }), dv("2025-11-25", null, { wochenstunden: 20 })];
  assert.equal(vollzeitaequivalente(z, "2026-11-25", 40), 1.5);
  assert.equal(vollzeitaequivalente([dv("2025-01-01", null, { wochenstunden: null })], "2026-11-25", 40), null);
  assert.equal(Math.round(betriebszugehoerigkeit(z, "2026-11-25") * 100) / 100, 1.5);
});

test("Personalkosten: gültiges Brutto je aktivem Dienstverhältnis, ohne Storno", () => {
  const a = dv("2025-01-01"), b = dv("2025-01-01"), weg = dv("2025-01-01", "2026-01-31");
  const entgelt = [
    { dienstverhaeltnis_id: a.dienstverhaeltnis_id, brutto: 1000, gueltig_ab: "2025-01-01", storniert_am: null },
    { dienstverhaeltnis_id: a.dienstverhaeltnis_id, brutto: 1200, gueltig_ab: "2026-06-01", storniert_am: null },
    { dienstverhaeltnis_id: a.dienstverhaeltnis_id, brutto: 9999, gueltig_ab: "2026-07-01", storniert_am: "2026-06-20T10:00:00Z" },
    { dienstverhaeltnis_id: a.dienstverhaeltnis_id, brutto: 1500, gueltig_ab: "2027-01-01", storniert_am: null },
    { dienstverhaeltnis_id: b.dienstverhaeltnis_id, brutto: 800, gueltig_ab: "2025-01-01" },
    { dienstverhaeltnis_id: weg.dienstverhaeltnis_id, brutto: 700, gueltig_ab: "2025-01-01" },
  ];
  assert.deepEqual(personalkosten(entgelt, [a, b, weg], "2026-11-25"), { summe: 2000, anzahl: 2 });
});
