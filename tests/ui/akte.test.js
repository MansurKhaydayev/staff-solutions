// Browser-Test der Personalakte mit simulierten Supabase-Antworten (nur erfundene Demo-Daten).
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/akte.test.js app /tmp/ui
const { chromium, demoDaten, starteServer, neueSeite, anmelden, pruefer, plus, ADRESSE } = require("./mock.js");

const [APP = "app", OUT = "/tmp/ui"] = process.argv.slice(2);
const { pruefe, ende } = pruefer();
const at = (iso) => iso.split("-").reverse().join(".");

// ---------------------------------------------------------------- Testdaten
function daten() {
  const d = demoDaten();
  d.mitarbeiter = [{ id: "m1", vorname: "Anna", nachname: "Berger" }];
  d.dienstverhaeltnis = [{ id: "d1", mitarbeiter_id: "m1", heimstandort_id: "s1", funktion_id: "f2",
    beschaeftigungsart: "teilzeit", wochenstunden: 20, eintritt: plus(-40), befristet_bis: plus(20), austritt: null,
    created_at: `${plus(-41)}T10:00:00Z` }];
  d.vertragsstand = [
    { id: "v1", dienstverhaeltnis_id: "d1", gueltig_ab: plus(-40), beschaeftigungsart: "teilzeit", wochenstunden: 20,
      arbeitstage_woche: 5, storniert_am: null, storno_grund: null },
    { id: "v2", dienstverhaeltnis_id: "d1", gueltig_ab: plus(30), beschaeftigungsart: "vollzeit", wochenstunden: 40,
      arbeitstage_woche: 5, storniert_am: null, storno_grund: null },
  ];
  d.entgelt = [
    { id: "e1", dienstverhaeltnis_id: "d1", vertragsstand_id: "v1", netto: 1000, brutto: 1300, quelle: "tabelle", gueltig_ab: plus(-40), storniert_am: null },
    { id: "e2", dienstverhaeltnis_id: "d1", vertragsstand_id: "v2", netto: 1500, brutto: 1950, quelle: "tabelle", gueltig_ab: plus(30), storniert_am: null },
  ];
  d.dokument = [
    { id: "k1", dienstverhaeltnis_id: "d1", kategorie: "vereinbarung", bezeichnung: "Vereinbarung Stundenanpassung",
      vertragsstand_id: "v2", datei_pfad: null, ersetzt_durch: null, created_at: `${plus(-1)}T09:00:00Z` },
  ];
  d.onboarding_stand = [
    { unterlage_id: "b1", bezeichnung: "Einverständnis Stundenaufzeichnung", pflicht: true, reihenfolge: 1, status: "fehlt", dokument_id: null },
    { unterlage_id: "b2", bezeichnung: "Bildaufnahme", pflicht: true, reihenfolge: 2, status: "erledigt", dokument_id: "o2" },
    { unterlage_id: "b3", bezeichnung: "Arbeitsanweisung", pflicht: true, reihenfolge: 3, status: "fehlt", dokument_id: null },
    { unterlage_id: "b4", bezeichnung: "Aushändigung Arbeitskleidung", pflicht: true, reihenfolge: 4, status: "fehlt", dokument_id: null },
  ];
  return d;
}

// akte_kopf so, wie die Datenbank ihn je Rolle liefert
function kopfFuer(d, rolle) {
  const r = d.rollen_recht.find((x) => x.rolle === rolle);
  const k = {
    dienstverhaeltnis_id: "d1", mitarbeiter_id: "m1", vorname: "Anna", nachname: "Berger", funktion: "Servicekraft",
    arbeitsort: "DemoFit Leoben", standort_id: "s1", standort_art: "studio", gesellschaft: "DemoFit Steiermark GmbH",
    eintritt: plus(-40), austritt: null, befristet_bis: plus(20),
    rechte: { kontakt: r.sieht_kontakt, personendaten: r.sieht_personendaten, entgelt: r.sieht_entgelt,
      lohnverrechnung: r.sieht_lohnverrechnung, dokumente: r.sieht_dokumente,
      buero: ["admin", "geschaeftsfuehrung", "hr"].includes(rolle),
      hochladen_onboarding: r.sieht_dokumente && rolle !== "buchhaltung" },
  };
  if (r.sieht_kontakt) Object.assign(k, { telefon: "+43 660 1111111", email: "anna@demo.invalid" });
  if (r.sieht_personendaten) {
    const aktiv = d.vertragsstand.filter((v) => !v.storniert_am);
    const heute = aktiv.filter((v) => v.gueltig_ab <= plus(0)).at(-1);
    Object.assign(k, { anrede: "Frau", geburtsdatum: "1995-03-14", strasse: "Probegasse 7", plz: "8700", ort: "Leoben",
      stand: { id: heute.id, gueltig_ab: heute.gueltig_ab, beschaeftigungsart: heute.beschaeftigungsart,
        wochenstunden: heute.wochenstunden, arbeitstage_woche: heute.arbeitstage_woche },
      kuenftig: aktiv.filter((v) => v.gueltig_ab > plus(0)),
      nachweis_fehlt: aktiv.filter((v) => v.id !== "v1" && !d.dokument.some((x) => x.vertragsstand_id === v.id && x.datei_pfad))
        .map((v) => v.gueltig_ab) });
  }
  if (r.sieht_entgelt) Object.assign(k, { entgelt: { netto: 1000, brutto: 1300, quelle: "tabelle" }, zulagen: [], sonderzahlung: true });
  if (r.sieht_lohnverrechnung) k.sv_nachreichen = true;
  if (r.sieht_dokumente) {
    const o = d.onboarding_stand;
    k.onboarding = { gesamt: o.length, erledigt: o.filter((x) => !["fehlt", "klaerung"].includes(x.status)).length,
      fehlt: o.filter((x) => x.status === "fehlt").map((x) => x.bezeichnung),
      klaerung: o.filter((x) => x.status === "klaerung").map((x) => x.bezeichnung) };
  }
  return k;
}

function verzeichnis(d) {
  return d.dienstverhaeltnis.map((v) => ({ dienstverhaeltnis_id: v.id, mitarbeiter_id: v.mitarbeiter_id, vorname: "Anna",
    nachname: "Berger", funktion_id: v.funktion_id, standort_id: v.heimstandort_id, eintritt: v.eintritt, austritt: v.austritt,
    erfasst_am: v.created_at, telefon: null, email: null, beschaeftigungsart: v.beschaeftigungsart,
    wochenstunden: v.wochenstunden, befristet_bis: v.befristet_bis }));
}

function rpcFuer(d, extra = {}) {
  return {
    mitarbeiter_verzeichnis: () => verzeichnis(d),
    akte_kopf: (b, p) => kopfFuer(d, p.rolle),
    onboarding_stand: () => d.onboarding_stand,
    ...extra,
  };
}

const sichtbareReiter = (p) => p.$$eval("#akte-reiter a", (a) => a.map((x) => x.textContent.trim()));
const inhalt = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- Teile
async function teilUebersicht(browser) {
  console.log("\n# Übersicht");
  const d = daten();
  const p = await neueSeite(browser, d, { rpc: rpcFuer(d) });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#mitarbeiter`);
  await p.waitForSelector("#liste tr");
  await p.click("#liste a.name");
  await p.waitForSelector("#akte-kopf h1");
  pruefe(p.url().endsWith("#akte/d1/uebersicht"), "Klick auf den Namen öffnet die Akte");
  const kopf = await inhalt(p, "#akte-kopf");
  pruefe(kopf.includes("Berger Anna") && kopf.includes("Servicekraft") && kopf.includes("DemoFit Leoben")
    && kopf.includes("DemoFit Steiermark GmbH"), `Kopf: Name, Funktion, Arbeitsort, GmbH (${kopf})`);
  pruefe(kopf.includes(`befristet bis ${at(plus(20))}`), "Kopf zeigt die Befristung");
  const hinweise = await inhalt(p, "#akte-hinweise");
  pruefe(hinweise.includes(`Nachweis fehlt: Stundenanpassung ab ${at(plus(30))}`), `Hinweis Nachweis fehlt (${hinweise})`);
  pruefe(hinweise.includes("Versicherungsnummer wird nachgereicht"), "Hinweis Versicherungsnummer");
  pruefe(hinweise.includes("Onboarding unvollständig (1 von 4)"), "Hinweis Onboarding");
  pruefe(hinweise.includes("Befristung endet in 20 Tagen"), "Hinweis Befristung");
  const ueb = await inhalt(p, "#akte-inhalt");
  pruefe(ueb.includes(`ab ${at(plus(30))}: 40 Stunden`), "künftige Anpassung sichtbar");
  pruefe(ueb.includes("20 Stunden") && ueb.includes("Teilzeit"), "aktuelle Stunden");
  pruefe(ueb.includes("1.300,00"), "Brutto sichtbar");
  pruefe(ueb.includes("Resturlaub") && ueb.includes("kommt mit der Stundenauswertung"), "Resturlaub-Platzhalter");
  pruefe(ueb.includes("Arbeitsanweisung"), "fehlende Onboarding-Unterlage aufgelistet");
  pruefe(JSON.stringify(await sichtbareReiter(p)) === JSON.stringify(
    ["Übersicht", "Stunden", "Anstellung & Verlauf", "Dokumente", "Lohnverrechnung", "Protokoll"]), "HR sieht alle Reiter");
  const hoehe = await p.$eval("#akte-reiter a", (a) => a.getBoundingClientRect().height);
  pruefe(hoehe >= 44, `Reiter mindestens 44 px hoch (${hoehe})`);
  await p.screenshot({ path: `${OUT}/a-akte-hr.png`, fullPage: true });
  await p.setViewportSize({ width: 1024, height: 768 });
  await p.screenshot({ path: `${OUT}/b-akte-ipad.png`, fullPage: true });

  await p.click("#akte-reiter >> text=Stunden");
  await p.waitForSelector("#akte-inhalt >> text=Stundenauswertung");
  pruefe(p.url().endsWith("#akte/d1/stunden"), "Reiter Stunden mit eigener Adresse");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();

  const v = await neueSeite(browser, d, { rpc: rpcFuer(d) });
  await anmelden(v, "verw@demo.invalid");
  await v.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await v.waitForSelector("#akte-kopf h1");
  pruefe(JSON.stringify(await sichtbareReiter(v)) === JSON.stringify(["Übersicht", "Stunden"]), "Verwaltung: nur Übersicht und Stunden");
  const vu = await inhalt(v, "#akte-inhalt");
  pruefe(!vu.includes("Entgelt") && !vu.includes("Geburtsdatum") && vu.includes("+43 660 1111111"), "Verwaltung: Kontakt, kein Entgelt");
  await v.goto(`${ADRESSE}#akte/d1/lohn`);
  await v.waitForTimeout(200);
  pruefe(v.url().endsWith("#akte/d1/uebersicht"), "gesperrter Reiter führt zur Übersicht");
  pruefe(v.jsFehler.length === 0, `keine JS-Fehler (${v.jsFehler.join("; ")})`);
  await v.close();
}

// Weitere Teile kommen mit den nächsten Aufgaben
const TEILE = [teilUebersicht];

(async () => {
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const teil of TEILE) await teil(browser);
  } catch (e) {
    pruefe(false, `Abbruch: ${e.message.split("\n")[0]}`);
  } finally {
    await browser.close();
    server.close();
  }
  ende("UI-Tests bestanden");
})();

module.exports = { daten, kopfFuer, rpcFuer, inhalt, at };
