import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pdfLib, pdfText, schriftLaden } from "./_global.mjs";
import { bearbeiten, Meldung } from "../../supabase/functions/analyse/ablauf.js";

const require = createRequire(import.meta.url);
const { belegschaft, verzeichnisFuer } = require("../ui/demo_startseite.js");

const schrift = await schriftLaden();

test("Edge Function „analyse“ nutzt dieselbe Schrift wie „mappe“", () => {
  const commit = (datei) => /staff-solutions\/([0-9a-f]{40})\/supabase\/functions\/mappe\/schrift\.js/.exec(readFileSync(datei, "utf8"))?.[1];
  assert.ok(commit("supabase/functions/analyse/index.ts"));
  assert.equal(commit("supabase/functions/analyse/index.ts"), commit("supabase/functions/mappe/index.ts"));
});

test("kennzahlen.js der Edge Function ist eine genaue Kopie der App", () => {
  assert.equal(readFileSync("supabase/functions/analyse/kennzahlen.js", "utf8"), readFileSync("app/kennzahlen.js", "utf8"));
});

const RECHTE = {
  geschaeftsfuehrung: { bezeichnung: "Geschäftsführung", sieht_personendaten: true, sieht_entgelt: true, reichweite: "alle", sieht_kontakt: true },
  studioleitung: { bezeichnung: "Studioleitung", sieht_personendaten: false, sieht_entgelt: false, reichweite: "zugeordnet", sieht_kontakt: true },
};

// Simulierte Datenbank: darf = Recht „Analyse herunterladen“
function abhFuer(rolle, { darf = true } = {}) {
  const b = belegschaft();
  b.zeilen[0].nachname = "Yılmaz";
  const aufrufe = [];
  const abh = {
    nutzer: async (t) => (t === "gut" ? { id: "u1" } : null),
    rpc: async (_t, name, params) => {
      aufrufe.push(name);
      if (name === "analyse_export_vermerken") {
        if (!darf) throw new Meldung("Mit deinem Zugang kannst du die Analyse nicht herunterladen.");
        abh.vermerkt = params;
        return 77;
      }
      if (name === "mitarbeiter_verzeichnis") return verzeichnisFuer(b.zeilen, RECHTE[rolle]);
      throw new Error(name);
    },
    lesen: async (_t, tabelle) => {
      aufrufe.push(tabelle);
      return {
        profil: [{ rolle }],
        rollen_recht: [RECHTE[rolle]],
        organisation: [{ name: "DemoFit", probezeit_monate: 1, vollzeit_stunden: 40 }],
        standort: [{ id: "s1", name: "Leoben" }, { id: "s2", name: "Bruck" }, { id: "s3", name: "Wien Mitte" }, { id: "s4", name: "Büro Graz" }],
        funktion: [{ id: "f1", name: "Reinigungskraft" }, { id: "f2", name: "Servicekraft" }, { id: "f3", name: "Studioleitung" }, { id: "f4", name: "Verwaltung" }],
        entgelt: b.entgelt,
      }[tabelle];
    },
    pdfLib,
    schrift,
    jetzt: () => new Date(),
  };
  return { abh, aufrufe };
}

test("ohne Anmeldung kein PDF", async () => {
  const { abh } = abhFuer("geschaeftsfuehrung");
  assert.equal((await bearbeiten({ token: null, daten: {} }, abh)).status, 401);
  assert.equal((await bearbeiten({ token: "falsch", daten: { jahr: 2026, monat: 1 } }, abh)).status, 401);
});

test("ungültige Eingaben", async () => {
  const { abh, aufrufe } = abhFuer("geschaeftsfuehrung");
  assert.equal((await bearbeiten({ token: "gut", daten: { jahr: 2026, monat: 13 } }, abh)).status, 400);
  assert.equal((await bearbeiten({ token: "gut", daten: { jahr: 2026, monat: 1, standort: "x; drop" } }, abh)).status, 400);
  assert.equal(aufrufe.length, 0);
});

test("ohne Recht: Meldung, und es werden keine Mitarbeiterdaten geladen", async () => {
  const { abh, aufrufe } = abhFuer("geschaeftsfuehrung", { darf: false });
  const a = await bearbeiten({ token: "gut", daten: { jahr: 2026, monat: 11 } }, abh);
  assert.equal(a.status, 403);
  assert.match(a.body.meldung, /nicht herunterladen/);
  assert.deepEqual(aufrufe, ["analyse_export_vermerken"]);
});

test("Geschäftsführung: PDF mit allen Teilen, Protokoll-Nr. und Brutto", async () => {
  const { abh, aufrufe } = abhFuer("geschaeftsfuehrung");
  const heute = new Date();
  const jahr = heute.getFullYear(), monat = heute.getMonth() + 1;
  const a = await bearbeiten({ token: "gut", daten: { jahr, monat } }, abh);
  assert.equal(a.status, 200);
  assert.equal(aufrufe[0], "analyse_export_vermerken", "zuerst vermerken, dann Daten laden");
  assert.deepEqual(abh.vermerkt, { p_jahr: jahr, p_monat: monat, p_standort: null });
  assert.equal(a.dateiname, `Personalanalyse-${jahr}-${String(monat).padStart(2, "0")}.pdf`);
  const t = (await pdfText(a.pdf)).join(" ");
  for (const teil of ["Personalanalyse", "Protokoll-Nr. 77", "Fluktuation 12 Monate", "Frühfluktuation", "Jahresübersicht",
    "Personalstand am Monatsende", "Personal heute", "Brutto im Monat", "Vollzeitäquivalente", "Was bald ansteht",
    "Befristung endet", "Noch nicht angemeldet", "Vertraulich", "Geschäftsführung", "Yılmaz"]) {
    assert.ok(t.includes(teil), `PDF enthält „${teil}“`);
  }
  assert.ok(aufrufe.includes("entgelt"));
});

test("Studioleitung mit Recht: nur eigenes Studio, kein Brutto, keine Befristungen, kein Entgelt geladen", async () => {
  const { abh, aufrufe } = abhFuer("studioleitung");
  const a = await bearbeiten({ token: "gut", daten: { jahr: 2026, monat: 11, standort: "de000000-0000-0000-0000-0000000000e1" } }, abh);
  assert.equal(a.status, 200);
  const t = (await pdfText(a.pdf)).join(" ");
  assert.ok(!t.includes("Brutto"));
  assert.ok(!t.includes("Befristung endet"));
  assert.ok(!t.includes("Vollzeitäquivalente"));
  assert.ok(!aufrufe.includes("entgelt"));
});
