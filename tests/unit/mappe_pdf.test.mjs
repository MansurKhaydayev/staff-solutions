import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfLib, pdfText, MINI_PNG, schriftLaden } from "./_global.mjs";
import { pdfErstellen } from "../../supabase/functions/mappe/pdf.js";

const schrift = await schriftLaden();

export const demoDienstzettel = () => ({
  art: "dienstzettel", dokument_nr: "1a2b3c4d-0000", inhalt_hash: "abcdef1234567890",
  kopf: { firma: "DemoFit Steiermark GmbH", adresse: "Musterstraße 1, 8010 Graz" },
  titel: "DIENSTZETTEL", untertitel: "gemäß § 2 AVRAG",
  felder: [["Arbeitnehmer/in", "Frau Anna Berger, geb. 14.03.1995"], ["Entgelt", "€ 1.300,00 brutto monatlich"]],
  abschnitte: [{ titel: "Urlaub", text: "Die Größe des Urlaubsanspruchs richtet sich nach dem Urlaubsgesetz." }],
  unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Arbeitnehmer/in" }, { rolle: "arbeitgeber", beschriftung: "Arbeitgeber" }],
});

test("Dienstzettel: Inhalt, Umlaute, Fußzeile", async () => {
  const pdf = await pdfErstellen(pdfLib, demoDienstzettel(), {}, schrift);
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
  const seiten = await pdfText(await pdfErstellen(pdfLib, i, {}, schrift));
  assert.ok(seiten.length > 1);
  seiten.forEach((s, n) => assert.ok(s.includes(`Seite ${n + 1} von ${seiten.length}`), `Fußzeile Seite ${n + 1}`));
});

test("Mitarbeiter-Unterschrift mit Ort und Datum", async () => {
  const pdf = await pdfErstellen(pdfLib, demoDienstzettel(), { mitarbeiter: { png: MINI_PNG, ort: "Leoben", datum: "24.11.2026" } }, schrift);
  const t = (await pdfText(pdf)).join(" ");
  assert.ok(t.includes("Leoben, 24.11.2026"));
});

test("Onboarding: nur eine Unterschriftszeile", async () => {
  const i = { ...demoDienstzettel(), art: "onboarding", titel: "Bildaufnahme", untertitel: null,
    unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }] };
  const t = (await pdfText(await pdfErstellen(pdfLib, i, {}, schrift))).join(" ");
  assert.ok(!t.includes("Arbeitgeber ") || !t.includes("noch nicht unterschrieben"));
  assert.ok(t.includes("Mitarbeiter/in"));
});

test("Abgelehnt: Vermerk statt Unterschrift", async () => {
  const i = { ...demoDienstzettel(), art: "onboarding", unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }] };
  const t = (await pdfText(await pdfErstellen(pdfLib, i, { abgelehnt: { ort: "Leoben", datum: "24.11.2026" } }, schrift))).join(" ");
  assert.ok(t.includes("Abgelehnt am 24.11.2026"));
});

test("Namen mit Š, ž, Œ erscheinen richtig im PDF", async () => {
  const i = demoDienstzettel();
  i.felder = [["Arbeitnehmer/in", "Frau Šárka Žižková, Œuvre"]];
  const t = (await pdfText(await pdfErstellen(pdfLib, i, {}, schrift))).join(" ");
  assert.ok(t.includes("Šárka Žižková, Œuvre"), t);
});

const textVon = async (inhalt, u = {}) => (await pdfText(await pdfErstellen(pdfLib, inhalt, u, schrift))).join(" ");
const mitFeld = (wert) => ({ ...demoDienstzettel(), felder: [["Arbeitnehmer/in", wert]] });

test("Namen mit ć č đ ş ı ğ erscheinen richtig", async () => {
  const t = await textVon(mitFeld("Frau Ivana Ćirić, Đurđević, Şahin Işık Doğan"));
  assert.ok(t.includes("Frau Ivana Ćirić, Đurđević, Şahin Işık Doğan"), t);
});

test("Kyrillisch und Griechisch", async () => {
  const t = await textVon(mitFeld("Олена Шевченко, Αλέξανδρος"));
  assert.ok(t.includes("Олена Шевченко, Αλέξανδρος"), t);
});

test("Zerlegte Akzente werden zusammengesetzt", async () => {
  const t = await textVon(mitFeld("Ciric".replace("C", "C\u0301")));
  assert.ok(t.includes("Ćiric"), t);
});

test("Unbekannte Zeichen werden zu ?", async () => {
  const t = await textVon(mitFeld("Anna 😀 王"));
  assert.ok(t.includes("Anna ? ?"), t);
});

test("Ort mit Sonderzeichen bei der Unterschrift", async () => {
  const t = await textVon(demoDienstzettel(), { mitarbeiter: { png: MINI_PNG, ort: "Čakovec", datum: "24.11.2026" } });
  assert.ok(t.includes("Čakovec, 24.11.2026"), t);
});

test("Leerer Feldwert", async () => {
  const i = { ...demoDienstzettel(), felder: [["Notiz", ""], ["Titel", null]] };
  assert.ok((await textVon(i)).includes("Notiz"));
});

test("Ohne Schrift: Fehler", async () => {
  await assert.rejects(pdfErstellen(pdfLib, demoDienstzettel(), {}), /Schrift fehlt/);
});
