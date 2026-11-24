import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfLib, pdfText, MINI_PNG } from "./_global.mjs";
import { pdfErstellen } from "../../supabase/functions/mappe/pdf.js";

export const demoDienstzettel = () => ({
  art: "dienstzettel", dokument_nr: "1a2b3c4d-0000", inhalt_hash: "abcdef1234567890",
  kopf: { firma: "DemoFit Steiermark GmbH", adresse: "Musterstraße 1, 8010 Graz" },
  titel: "DIENSTZETTEL", untertitel: "gemäß § 2 AVRAG",
  felder: [["Arbeitnehmer/in", "Frau Anna Berger, geb. 14.03.1995"], ["Entgelt", "€ 1.300,00 brutto monatlich"]],
  abschnitte: [{ titel: "Urlaub", text: "Die Größe des Urlaubsanspruchs richtet sich nach dem Urlaubsgesetz." }],
  unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Arbeitnehmer/in" }, { rolle: "arbeitgeber", beschriftung: "Arbeitgeber" }],
});

test("Dienstzettel: Inhalt, Umlaute, Fußzeile", async () => {
  const pdf = await pdfErstellen(pdfLib, demoDienstzettel(), {});
  assert.equal(Buffer.from(pdf.slice(0, 4)).toString(), "%PDF");
  const t = (await pdfText(pdf)).join(" ");
  for (const s of ["DIENSTZETTEL", "Frau Anna Berger", "€ 1.300,00", "Größe", "Dokument-Nr. 1a2b3c4d", "Seite 1 von"]) {
    assert.ok(t.includes(s), `fehlt: ${s}`);
  }
  assert.ok(t.includes("noch nicht unterschrieben"), "Arbeitgeber noch offen");
});

test("Langer Text: mehrere Seiten, jede mit Fußzeile", async () => {
  const i = demoDienstzettel();
  i.abschnitte = Array.from({ length: 40 }, (_, n) => ({ titel: `Punkt ${n + 1}`, text: "Ein längerer Absatz mit Text. ".repeat(8) }));
  const seiten = await pdfText(await pdfErstellen(pdfLib, i, {}));
  assert.ok(seiten.length > 1);
  seiten.forEach((s, n) => assert.ok(s.includes(`Seite ${n + 1} von ${seiten.length}`), `Fußzeile Seite ${n + 1}`));
});

test("Mitarbeiter-Unterschrift mit Ort und Datum", async () => {
  const pdf = await pdfErstellen(pdfLib, demoDienstzettel(), { mitarbeiter: { png: MINI_PNG, ort: "Leoben", datum: "24.11.2026" } });
  const t = (await pdfText(pdf)).join(" ");
  assert.ok(t.includes("Leoben, 24.11.2026"));
});

test("Onboarding: nur eine Unterschriftszeile", async () => {
  const i = { ...demoDienstzettel(), art: "onboarding", titel: "Bildaufnahme", untertitel: null,
    unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }] };
  const t = (await pdfText(await pdfErstellen(pdfLib, i, {}))).join(" ");
  assert.ok(!t.includes("Arbeitgeber ") || !t.includes("noch nicht unterschrieben"));
  assert.ok(t.includes("Mitarbeiter/in"));
});

test("Abgelehnt: Vermerk statt Unterschrift", async () => {
  const i = { ...demoDienstzettel(), art: "onboarding", unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }] };
  const t = (await pdfText(await pdfErstellen(pdfLib, i, { abgelehnt: { ort: "Leoben", datum: "24.11.2026" } }))).join(" ");
  assert.ok(t.includes("Abgelehnt am 24.11.2026"));
});

test("Namen mit Š, ž, Œ (WinAnsi) erscheinen richtig im PDF", async () => {
  const i = demoDienstzettel();
  i.felder = [["Arbeitnehmer/in", "Frau Šárka Žižková, Œuvre"]];
  const t = (await pdfText(await pdfErstellen(pdfLib, i, {}))).join(" ");
  assert.ok(t.includes("Šárka Žižková, Œuvre"), t);
});
