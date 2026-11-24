import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { pdfLib, pdfText } from "./_global.mjs";
import { bearbeiten, Meldung } from "../../supabase/functions/mappe/ablauf.js";
import { demoDienstzettel } from "./mappe_pdf.test.mjs";

// Gültiges PNG mit zufälligen Pixeln (lässt sich nicht klein packen)
function crc32(b) {
  let c, crc = 0xffffffff;
  for (const x of b) { c = (crc ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function block(typ, daten) {
  const t = Buffer.from(typ); const l = Buffer.alloc(4); l.writeUInt32BE(daten.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, daten])));
  return Buffer.concat([l, t, daten, c]);
}
function png(w, h) {
  const kopf = Buffer.alloc(13); kopf.writeUInt32BE(w, 0); kopf.writeUInt32BE(h, 4); kopf[8] = 8; kopf[9] = 0;
  const roh = Buffer.alloc((w + 1) * h); for (let i = 0; i < roh.length; i++) roh[i] = i % (w + 1) === 0 ? 0 : Math.random() * 256;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), block("IHDR", kopf),
    block("IDAT", deflateSync(roh)), block("IEND", Buffer.alloc(0))]);
}
const GROSS = png(60, 30);
const KLEIN = png(1, 1);

const ORG = "org1", DV = "dv1";
function mappe(extra = {}) {
  return {
    organisation_id: ORG, dienstverhaeltnis_id: DV, ort: "Leoben", name: "Anna Berger",
    schritte: [
      { art: "dienstzettel", status: "offen", fassung: "f-dz", inhalt: demoDienstzettel() },
      { art: "onboarding", unterlage_id: "u-b2", status: "offen", fassung: "f-b2",
        inhalt: { ...demoDienstzettel(), art: "onboarding", titel: "Bildaufnahme", unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }] } },
    ],
    ...extra,
  };
}

function fakes({ dienstFehler } = {}) {
  const log = { uploads: [], dienst: [], nutzer: [], geladen: [] };
  const abh = {
    nutzer: async (t) => (t === "gut" ? { id: "user-1" } : null),
    rpcAlsNutzer: async (t, name, p) => {
      log.nutzer.push({ name, p });
      if (name === "mappe_inhalt") return mappe();
      if (name === "arbeitgeber_inhalt") {
        return { dokument_id: "dok-1", organisation_id: ORG, dienstverhaeltnis_id: DV, fassung: "f-ag", inhalt: demoDienstzettel(),
          mitarbeiter: { png_pfad: `${ORG}/${DV}/unterschrift/m.png`, ort: "Leoben", datum: "2026-11-24T08:00:00Z" }, arbeitgeber_ort: "Graz" };
      }
      throw new Error("unbekannt");
    },
    rpcAlsDienst: async (name, p) => { log.dienst.push({ name, p }); if (dienstFehler) throw new Meldung(dienstFehler); return "neu-id"; },
    hochladen: async (pfad, bytes, typ) => { log.uploads.push({ pfad, bytes, typ }); },
    laden: async (pfad) => { log.geladen.push(pfad); return GROSS; },
    sha256: async (b) => createHash("sha256").update(b).digest("hex"),
    pdfLib,
    uuid: () => "11112222-3333-4444-5555-666677778888",
  };
  return { abh, log };
}
const b64 = (b) => Buffer.from(b).toString("base64");
const ma = (extra = {}) => ({ aktion: "mitarbeiter", dienstverhaeltnis_id: DV, art: "dienstzettel", fassung: "f-dz",
  ergebnis: "unterschrieben", png_base64: b64(GROSS), ...extra });

test("ohne gültigen Zugang: 401", async () => {
  const { abh } = fakes();
  assert.equal((await bearbeiten({ token: null, daten: ma() }, abh)).status, 401);
  assert.equal((await bearbeiten({ token: "falsch", daten: ma() }, abh)).status, 401);
});

test("falsche Fassung: 400, nichts hochgeladen", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: ma({ fassung: "alt" }) }, abh);
  assert.equal(r.status, 400);
  assert.match(r.body.meldung, /Die Daten wurden geändert/);
  assert.equal(log.uploads.length, 0);
});

test("zu kleine Unterschrift: 400 „Bitte deutlich unterschreiben.“", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: ma({ png_base64: b64(KLEIN) }) }, abh);
  assert.equal(r.status, 400);
  assert.equal(r.body.meldung, "Bitte deutlich unterschreiben.");
  assert.equal(log.uploads.length, 0);
});

test("kein PNG: 400", async () => {
  const { abh } = fakes();
  const r = await bearbeiten({ token: "gut", daten: ma({ png_base64: b64(Buffer.from("x".repeat(3000))) }) }, abh);
  assert.equal(r.status, 400);
});

test("Dienstzettel unterschrieben: PDF + PNG hochgeladen, mappe_ablegen als Dienst", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: ma({ dringend_grund: "Personalmangel" }) }, abh);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { dokument_id: "neu-id" });
  assert.equal(log.uploads.length, 2);
  const [pdf, bild] = log.uploads;
  assert.equal(pdf.pfad, `${ORG}/${DV}/vereinbarung/11112222-3333-4444-5555-666677778888.pdf`);
  assert.equal(pdf.typ, "application/pdf");
  assert.equal(bild.pfad, `${ORG}/${DV}/unterschrift/11112222-3333-4444-5555-666677778888.png`);
  assert.equal(bild.typ, "image/png");
  const t = (await pdfText(pdf.bytes)).join(" ");
  assert.ok(t.includes("Dokument-Nr. 11112222"), "Dokument-Nr. aus dem Dateinamen");
  assert.ok(t.includes("Leoben, "), "Ort der Unterschrift");
  assert.equal(log.dienst.length, 1);
  const { name, p } = log.dienst[0];
  assert.equal(name, "mappe_ablegen");
  assert.equal(p.p_user, "user-1");
  assert.equal(p.p_art, "dienstzettel");
  assert.equal(p.p_fassung, "f-dz");
  assert.equal(p.p_ergebnis, "unterschrieben");
  assert.equal(p.p_pdf_pfad, pdf.pfad);
  assert.equal(p.p_pdf_hash, createHash("sha256").update(pdf.bytes).digest("hex"));
  assert.equal(p.p_png_hash, createHash("sha256").update(GROSS).digest("hex"));
  assert.equal(p.p_dringend_grund, "Personalmangel");
});

test("Fristfehler aus der Datenbank: 400 mit frist: true, Präfix entfernt", async () => {
  const { abh } = fakes({ dienstFehler: "FRIST: Zu kurzfristig. Frühester Dienstantritt: 26.11.2026." });
  const r = await bearbeiten({ token: "gut", daten: ma() }, abh);
  assert.equal(r.status, 400);
  assert.equal(r.body.frist, true);
  assert.equal(r.body.meldung, "Zu kurzfristig. Frühester Dienstantritt: 26.11.2026.");
});

test("Frist verletzt ohne Grund: Meldung vor dem Hochladen", async () => {
  const { abh, log } = fakes();
  const orig = abh.rpcAlsNutzer;
  abh.rpcAlsNutzer = async (t, name, p) => name === "mappe_inhalt"
    ? { ...mappe(), frist: { fruehester: "2026-11-26", verletzt: true, dringend_grund: null } } : orig(t, name, p);
  const r = await bearbeiten({ token: "gut", daten: ma() }, abh);
  assert.equal(r.status, 400);
  assert.equal(r.body.frist, true);
  assert.equal(r.body.meldung, "Zu kurzfristig. Frühester Dienstantritt ist Donnerstag, 26.11.2026. Bei dringendem Bedarf „Dringende Anmeldung“ wählen.");
  assert.equal(log.uploads.length, 0);
  const mitGrund = await bearbeiten({ token: "gut", daten: ma({ dringend_grund: "Krankheitsausfall" }) }, abh);
  assert.equal(mitGrund.status, 200);
});

test("Onboarding abgelehnt: nur PDF, Vermerk „Abgelehnt am“", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: { aktion: "mitarbeiter", dienstverhaeltnis_id: DV, art: "onboarding",
    unterlage_id: "u-b2", fassung: "f-b2", ergebnis: "abgelehnt" } }, abh);
  assert.equal(r.status, 200);
  assert.equal(log.uploads.length, 1);
  assert.match(log.uploads[0].pfad, /^org1\/dv1\/onboarding\/.+\.pdf$/);
  assert.ok((await pdfText(log.uploads[0].bytes)).join(" ").includes("Abgelehnt am"));
  const { p } = log.dienst[0];
  assert.equal(p.p_ergebnis, "abgelehnt");
  assert.equal(p.p_unterlage_id, "u-b2");
  assert.equal(p.p_png_pfad, null);
});

test("Unterlage nicht in der Mappe: 400", async () => {
  const { abh } = fakes();
  const r = await bearbeiten({ token: "gut", daten: ma({ art: "onboarding", unterlage_id: "fremd" }) }, abh);
  assert.equal(r.status, 400);
});

test("Arbeitgeber: lädt Mitarbeiter-Unterschrift, PDF mit beiden, arbeitgeber_ablegen", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: { aktion: "arbeitgeber", dokument_id: "dok-1", fassung: "f-ag", png_base64: b64(GROSS) } }, abh);
  assert.equal(r.status, 200);
  assert.deepEqual(log.geladen, [`${ORG}/${DV}/unterschrift/m.png`]);
  assert.equal(log.uploads.length, 2);
  const t = (await pdfText(log.uploads[0].bytes)).join(" ");
  assert.ok(t.includes("Leoben, 24.11.2026") && t.includes("Graz, "), "beide Orte und Daten");
  assert.ok(!t.includes("noch nicht unterschrieben"));
  const { name, p } = log.dienst[0];
  assert.equal(name, "arbeitgeber_ablegen");
  assert.equal(p.p_user, "user-1");
  assert.equal(p.p_dokument_id, "dok-1");
  assert.equal(p.p_fassung, "f-ag");
  assert.equal(p.p_pdf_hash, createHash("sha256").update(log.uploads[0].bytes).digest("hex"));
});

test("Arbeitgeber: falsche Fassung → 400", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: { aktion: "arbeitgeber", dokument_id: "dok-1", fassung: "alt", png_base64: b64(GROSS) } }, abh);
  assert.equal(r.status, 400);
  assert.equal(log.uploads.length, 0);
});

test("Fehler aus der Datenbank beim Lesen: 400 mit Meldung", async () => {
  const { abh } = fakes();
  abh.rpcAlsNutzer = async () => { throw new Meldung("Keine Berechtigung für diese Mappe."); };
  const r = await bearbeiten({ token: "gut", daten: ma() }, abh);
  assert.equal(r.status, 400);
  assert.equal(r.body.meldung, "Keine Berechtigung für diese Mappe.");
});

test("technischer Fehler: 500 ohne interne Details", async () => {
  const { abh } = fakes();
  abh.hochladen = async () => { throw new TypeError("fetch failed: geheim"); };
  const orig = console.error; console.error = () => {};
  const r = await bearbeiten({ token: "gut", daten: ma() }, abh);
  console.error = orig;
  assert.equal(r.status, 500);
  assert.ok(!r.body.meldung.includes("geheim"));
});

test("unbekannte Aktion: 400", async () => {
  const { abh } = fakes();
  assert.equal((await bearbeiten({ token: "gut", daten: { aktion: "x" } }, abh)).status, 400);
});
