import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pdfLib, pdfText, schriftLaden } from "./_global.mjs";
import { bearbeiten, Meldung } from "../../supabase/functions/mappe/ablauf.js";

const schrift = await schriftLaden();
const ORG = "org1", DV = "dv1";

const inhalt = (extra = {}) => ({
  organisation_id: ORG, dienstverhaeltnis_id: DV, meldung_id: "m-1", typ: "austrittsmeldung", kategorie: "abmeldung",
  fassung: "f-m", dokument_id: null,
  inhalt: {
    art: "austrittsmeldung", kopf: { firma: "DemoFit Steiermark GmbH", adresse: "Musterstraße 1, 8010 Graz" },
    titel: "AUSTRITTSMELDUNG", untertitel: "an Demo Lohnbüro",
    felder: [["Arbeitnehmer/in", "Frau Anna Đorđević, geb. 14.03.1995"], ["Letzter Arbeitstag", "30.11.2026"],
      ["Art des Austritts", "Lösung in der Probezeit"]],
    abschnitte: [{ titel: "Hinweis", text: "Urlaubsersatzleistung" }], unterschrift_zeilen: [],
  },
  ...extra,
});

function fakes(i = inhalt()) {
  const log = { uploads: [], dienst: [], nutzer: [] };
  const abh = {
    nutzer: async (t) => (t === "gut" ? { id: "user-1" } : null),
    rpcAlsNutzer: async (t, name, p) => { log.nutzer.push({ name, p }); if (name === "meldung_inhalt") return i; throw new Error("unbekannt"); },
    rpcAlsDienst: async (name, p) => { log.dienst.push({ name, p }); return "dok-neu"; },
    hochladen: async (pfad, bytes, typ) => { log.uploads.push({ pfad, bytes, typ }); },
    laden: async () => { throw new Error("nicht erwartet"); },
    sha256: async (b) => createHash("sha256").update(b).digest("hex"),
    pdfLib, schrift, uuid: () => "aaaabbbb-3333-4444-5555-666677778888",
  };
  return { abh, log };
}

test("Meldung: PDF mit Name, Datum und Art, abgelegt unter abmeldung/, meldung_ablegen als Dienst", async () => {
  const { abh, log } = fakes();
  const r = await bearbeiten({ token: "gut", daten: { aktion: "meldung", meldung_id: "m-1" } }, abh);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { dokument_id: "dok-neu" });
  assert.deepEqual(log.nutzer[0], { name: "meldung_inhalt", p: { p_meldung_id: "m-1" } });
  assert.equal(log.uploads.length, 1);
  assert.equal(log.uploads[0].pfad, `${ORG}/${DV}/abmeldung/aaaabbbb-3333-4444-5555-666677778888.pdf`);
  const t = (await pdfText(log.uploads[0].bytes)).join(" ");
  for (const s of ["AUSTRITTSMELDUNG", "Đorđević", "30.11.2026", "Lösung in der Probezeit", "Dokument-Nr. aaaabbbb"]) {
    assert.ok(t.includes(s), `fehlt: ${s}`);
  }
  const { name, p } = log.dienst[0];
  assert.equal(name, "meldung_ablegen");
  assert.deepEqual(Object.keys(p).sort(), ["p_fassung", "p_hash", "p_meldung_id", "p_pfad", "p_user"]);
  assert.equal(p.p_user, "user-1");
  assert.equal(p.p_fassung, "f-m");
  assert.equal(p.p_hash, createHash("sha256").update(log.uploads[0].bytes).digest("hex"));
});

test("Meldung: Storno wird unter storno/ abgelegt", async () => {
  const { abh, log } = fakes(inhalt({ typ: "stornomeldung", kategorie: "storno" }));
  await bearbeiten({ token: "gut", daten: { aktion: "meldung", meldung_id: "m-1" } }, abh);
  assert.match(log.uploads[0].pfad, /\/storno\/[^/]+\.pdf$/);
});

test("Meldung: PDF schon vorhanden → dasselbe Dokument, nichts hochgeladen", async () => {
  const { abh, log } = fakes(inhalt({ dokument_id: "schon-da" }));
  const r = await bearbeiten({ token: "gut", daten: { aktion: "meldung", meldung_id: "m-1" } }, abh);
  assert.deepEqual(r.body, { dokument_id: "schon-da" });
  assert.equal(log.uploads.length, 0);
  assert.equal(log.dienst.length, 0);
});

test("Meldung: unerwartete Kategorie wird abgelehnt", async () => {
  const { abh, log } = fakes(inhalt({ kategorie: "vereinbarung" }));
  const r = await bearbeiten({ token: "gut", daten: { aktion: "meldung", meldung_id: "m-1" } }, abh);
  assert.equal(r.status, 400);
  assert.equal(log.uploads.length, 0);
});

test("Meldung: Fehler der Datenbank (z. B. kein Büro) → 400 mit Meldung", async () => {
  const { abh } = fakes();
  abh.rpcAlsNutzer = async () => { throw new Meldung("Das darf nur das Personalbüro."); };
  const r = await bearbeiten({ token: "gut", daten: { aktion: "meldung", meldung_id: "m-1" } }, abh);
  assert.equal(r.status, 400);
  assert.equal(r.body.meldung, "Das darf nur das Personalbüro.");
});
