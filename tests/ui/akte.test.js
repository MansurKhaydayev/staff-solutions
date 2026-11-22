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


async function teilVerlauf(browser) {
  console.log("\n# Anstellung & Verlauf");
  const d = daten();
  // Die geplante Anpassung wurde storniert (Tippfehler) – heute gilt nur der erste Stand
  Object.assign(d.vertragsstand[1], { storniert_am: `${plus(-1)}T10:00:00Z`, storno_grund: "Tippfehler beim Datum" });
  d.entgelt[1].storniert_am = `${plus(-1)}T10:00:00Z`;
  const gesendet = [];
  let aufrufe = 0;
  const p = await neueSeite(browser, d, { rpc: rpcFuer(d, {
    stunden_anpassen: (b) => {
      gesendet.push(b);
      aufrufe += 1;
      if (aufrufe > 1) return { status: 400, body: { message: `Für den ${at(b.p_gueltig_ab)} gibt es schon einen Stand.` } };
      d.vertragsstand.push({ id: "v3", dienstverhaeltnis_id: "d1", gueltig_ab: b.p_gueltig_ab, beschaeftigungsart: b.p_beschaeftigungsart,
        wochenstunden: b.p_wochenstunden, arbeitstage_woche: b.p_arbeitstage_woche, storniert_am: null, storno_grund: null });
      d.entgelt.push({ id: "e3", dienstverhaeltnis_id: "d1", vertragsstand_id: "v3", netto: b.p_netto, brutto: 1950, quelle: "tabelle",
        gueltig_ab: b.p_gueltig_ab, storniert_am: null });
      d.dokument.push({ id: "k3", dienstverhaeltnis_id: "d1", kategorie: "vereinbarung", bezeichnung: "Vereinbarung Stundenanpassung",
        vertragsstand_id: "v3", datei_pfad: null, ersetzt_durch: null, created_at: `${plus(0)}T09:00:00Z` });
      return "v3";
    },
    stand_stornieren: (b) => { gesendet.push(b); return null; },
  }) });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/verlauf`);
  await p.waitForSelector("#verlauf-tabelle tbody tr");
  const zeilen = await p.$$eval("#verlauf-tabelle tbody tr", (t) => t.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  pruefe(zeilen.length === 2, `zwei Stände in der Tabelle (${zeilen.length})`);
  pruefe(zeilen.some((z) => z.includes("Dienstzettel")), "erster Stand: Dienstzettel");
  pruefe(zeilen.some((z) => z.includes("storniert") && z.includes("Tippfehler beim Datum")), "stornierter Stand mit Grund");
  pruefe(await p.$eval("#verlauf-tabelle tbody tr.storniert", () => true).catch(() => false), "stornierter Stand ist markiert");

  await p.click("text=Stundenanpassung eintragen");
  const f = "#stundenanpassung";
  pruefe(await p.inputValue(`${f} [name=wochenstunden]`) === "20", "Formular mit aktuellem Stand vorbelegt");
  await p.fill(`${f} [name=gueltig_ab]`, plus(30));
  await p.fill(`${f} [name=wochenstunden]`, "40");
  await p.fill(`${f} [name=arbeitstage]`, "1");
  await p.click(`${f} button[type=submit]`);
  pruefe((await p.textContent(`${f} [data-fehler=wochenstunden]`)).includes("pro Tag"), "40 Stunden an 1 Tag: Feldmeldung");
  pruefe(gesendet.length === 0, "bei Fehler wird nichts gesendet");
  await p.selectOption(`${f} [name=beschaeftigungsart]`, "vollzeit");
  await p.fill(`${f} [name=arbeitstage]`, "5");
  await p.fill(`${f} [name=netto]`, "1500");
  pruefe((await p.textContent(`${f} [data-fehler=wochenstunden]`)) === "", "Feldmeldung verschwindet nach der Korrektur");
  const vorschau = await inhalt(p, "#anpassung-vorschau");
  pruefe(vorschau.includes("20 → 40 Stunden") && vorschau.includes("€ 1.950,00"), `Vorschau vorher → nachher (${vorschau})`);
  await p.screenshot({ path: `${OUT}/c-stundenanpassung.png`, fullPage: true });
  await p.click(`${f} button[type=submit]`);
  await p.waitForFunction(() => document.querySelectorAll("#verlauf-tabelle tbody tr").length === 3);
  pruefe(JSON.stringify(Object.keys(gesendet[0]).sort()) === JSON.stringify(["p_arbeitstage_woche", "p_beschaeftigungsart",
    "p_dienstverhaeltnis_id", "p_gueltig_ab", "p_netto", "p_wochenstunden"]), "genau die sechs Werte gesendet");
  pruefe(gesendet[0].p_wochenstunden === 40 && gesendet[0].p_netto === 1500 && gesendet[0].p_gueltig_ab === plus(30), "Werte als Zahlen und Datum");
  const neu = await inhalt(p, "#verlauf-tabelle");
  pruefe(neu.includes("Nachweis fehlt"), "neue Anpassung zeigt „Nachweis fehlt“");
  await p.click("#verlauf-tabelle [data-nachweis-stand='v3']");
  await p.waitForSelector("#hochladen-form");
  pruefe((await inhalt(p, "#hochladen-form h3")).includes("Vereinbarung Stundenanpassung"), "„Nachweis hochladen“ öffnet den Dialog zur Vereinbarung");
  await p.click("#hochladen-form [data-aktion=abbrechen]");

  // Fehler aus der Datenbank erscheint im Formular
  await p.click("text=Stundenanpassung eintragen");
  await p.fill(`${f} [name=gueltig_ab]`, plus(60));
  await p.click(`${f} button[type=submit]`);
  await p.waitForSelector(`${f} .fehler:not(:empty)`);
  pruefe((await p.textContent(`${f} .fehler`)).includes("gibt es schon einen Stand"), "Meldung der Datenbank im Formular");
  await p.click(`${f} [data-aktion=abbrechen]`);

  // Storno mit Pflichtgrund
  await p.click("#verlauf-tabelle button[data-storno]");
  await p.click("#storno-form button[type=submit]");
  pruefe((await p.textContent("#storno-form .fehler")).includes("Grund"), "Storno ohne Grund wird nicht gesendet");
  await p.fill("#storno-form [name=grund]", "Falsches Datum");
  await p.click("#storno-form button[type=submit]");
  await p.waitForTimeout(200);
  pruefe(gesendet.at(-1).p_grund === "Falsches Datum" && gesendet.at(-1).p_vertragsstand_id === "v3", "Storno gesendet");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();

  // Ohne Büro-Recht: kein Knopf; ohne Entgelt-Recht: keine Beträge
  d.rollen_recht.find((r) => r.rolle === "regionalleitung").sieht_entgelt = false;
  const rl = await neueSeite(browser, d, { rpc: rpcFuer(d) });
  await anmelden(rl, "rl@demo.invalid");
  await rl.goto(`${ADRESSE}#akte/d1/verlauf`);
  await rl.waitForSelector("#verlauf-tabelle tbody tr");
  pruefe(!(await rl.$("text=Stundenanpassung eintragen")) && !(await rl.$("button[data-storno]")), "Regionalleitung: keine Knöpfe");
  const kopfzeile = await inhalt(rl, "#verlauf-tabelle thead");
  pruefe(!kopfzeile.includes("Netto") && !kopfzeile.includes("Brutto"), "ohne Entgelt-Recht keine Beträge");
  pruefe(rl.jsFehler.length === 0, `keine JS-Fehler (${rl.jsFehler.join("; ")})`);
  await rl.close();
}

function dokumentDaten() {
  const d = daten();
  const datei = (id, kategorie, bezeichnung, extra = {}) => ({ id, dienstverhaeltnis_id: "d1", kategorie, bezeichnung,
    datei_pfad: `o/d1/${kategorie}/${id}.pdf`, datei_typ: "application/pdf", datei_groesse: 120000, ersetzt_durch: null,
    vertragsstand_id: null, onboarding_unterlage_id: null, onboarding_ergebnis: null,
    hochgeladen_am: `${plus(-3)}T08:00:00Z`, created_at: `${plus(-3)}T08:00:00Z`, ...extra });
  d.dokument = [
    datei("s1", "sonstiges", "Strafregisterauszug"),
    datei("o2alt", "onboarding", "Bildaufnahme", { onboarding_unterlage_id: "b2", onboarding_ergebnis: "unterschrieben", ersetzt_durch: "o2" }),
    datei("o2", "onboarding", "Bildaufnahme", { onboarding_unterlage_id: "b2", onboarding_ergebnis: "unterschrieben" }),
    datei("a1", "anmeldung", "Anmeldung ÖGK"),
    { ...datei("k1", "vereinbarung", "Vereinbarung Stundenanpassung", { vertragsstand_id: "v2" }), datei_pfad: null, hochgeladen_am: null },
  ];
  return d;
}

async function teilDokumente(browser) {
  console.log("\n# Dokumente");
  const d = dokumentDaten();
  let ablegenFehler = false;
  const abgelegt = [];
  const p = await neueSeite(browser, d, { rpc: rpcFuer(d, {
    dokument_ablegen: (b) => {
      abgelegt.push(b);
      if (ablegenFehler) { ablegenFehler = false; return { status: 503, body: { message: "Verbindung unterbrochen" } }; }
      const id = `neu${abgelegt.length}`;
      d.dokument.push({ id, dienstverhaeltnis_id: "d1", kategorie: b.p_kategorie, bezeichnung: b.p_bezeichnung, datei_pfad: b.p_pfad,
        ersetzt_durch: null, onboarding_unterlage_id: b.p_onboarding_unterlage_id, onboarding_ergebnis: b.p_onboarding_ergebnis,
        hochgeladen_am: `${plus(0)}T09:00:00Z`, created_at: `${plus(0)}T09:00:00Z` });
      return id;
    },
  }) });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/dokumente`);
  await p.waitForSelector("#dokument-gruppen h2");
  const gruppen = await p.$$eval("#dokument-gruppen h2", (h) => h.map((x) => x.textContent.trim()));
  pruefe(JSON.stringify(gruppen) === JSON.stringify(["Anmeldung", "Onboarding", "Vereinbarungen", "Sonstiges"]), `Gruppen in fester Reihenfolge (${gruppen})`);
  pruefe((await inhalt(p, "#dokument-gruppen")).includes("frühere Fassungen"), "ersetzte Datei unter „frühere Fassungen“");
  pruefe((await inhalt(p, "#dokument-gruppen")).includes("Datei fehlt"), "Vereinbarung ohne Datei: „Datei fehlt“");
  const check = await inhalt(p, "#dokumente-onboarding");
  pruefe(check.includes("Bildaufnahme") && check.includes("erledigt") && check.includes("fehlt"), "Onboarding-Checkliste");

  // Falscher Dateityp: kein Hochladen
  await p.click("text=Unterlage hochladen");
  const f = "#hochladen-form";
  await p.selectOption(`${f} [name=kategorie]`, "onboarding");
  await p.selectOption(`${f} [name=unterlage]`, "b1");
  await p.setInputFiles(`${f} [name=datei]`, { name: "bild.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await p.click(`${f} button[type=submit]`);
  pruefe((await p.textContent(`${f} .fehler`)).includes("Nur PDF, JPG oder PNG."), "GIF wird abgelehnt");
  pruefe(!p.anfragen.some((a) => a.methode === "POST" && a.pfad.startsWith("/storage/v1/object/personalakte")), "kein Hochladen bei falschem Typ");

  // PDF hochladen, erster Eintrag scheitert, erneuter Versuch ohne zweites Hochladen
  ablegenFehler = true;
  await p.setInputFiles(`${f} [name=datei]`, { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await p.click(`${f} button[type=submit]`);
  await p.waitForSelector("text=Erneut versuchen");
  const posts = () => p.anfragen.filter((a) => a.methode === "POST" && a.pfad.startsWith("/storage/v1/object/personalakte/"));
  pruefe(posts().length === 1 && /^\/storage\/v1\/object\/personalakte\/o\/d1\/onboarding\/[0-9a-f-]{36}\.pdf$/.test(posts()[0].pfad),
    `Datei unter Firma/Person/Kategorie abgelegt (${posts()[0]?.pfad})`);
  pruefe((await p.textContent(`${f} .fehler`)).includes("Verbindung unterbrochen"), "Fehlermeldung beim Eintragen");
  await p.click("text=Erneut versuchen");
  await p.waitForSelector(`${f}`, { state: "detached" });
  pruefe(posts().length === 1, "erneuter Versuch lädt die Datei nicht noch einmal hoch");
  const letzter = abgelegt.at(-1);
  pruefe(/^[0-9a-f]{64}$/.test(letzter.p_hash) && letzter.p_onboarding_unterlage_id === "b1" && letzter.p_kategorie === "onboarding"
    && letzter.p_bezeichnung === "Einverständnis Stundenaufzeichnung", "Eintrag mit Fingerabdruck und Unterlage");

  // Ansehen: signierter Link in neuem Tab
  const [tab] = await Promise.all([p.context().waitForEvent("page"), p.click("#dokument-gruppen [data-ansehen='o2']")]);
  pruefe(p.anfragen.some((a) => a.pfad === "/storage/v1/object/sign/personalakte/o/d1/onboarding/o2.pdf"), "signierter Link angefordert");
  pruefe(Boolean(tab), "Datei öffnet in neuem Tab");
  await tab.close();

  // Nachweis zu bestehendem Eintrag hochladen
  await p.click("#dokument-gruppen [data-nachweis='k1']");
  await p.setInputFiles(`${f} [name=datei]`, { name: "vereinbarung.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 v") });
  await p.click(`${f} button[type=submit]`);
  await p.waitForSelector(`${f}`, { state: "detached" });
  pruefe(abgelegt.at(-1).p_dokument_id === "k1" && abgelegt.at(-1).p_kategorie === "vereinbarung", "Nachweis wird am bestehenden Eintrag ergänzt");
  pruefe(Boolean(await p.$("#dokument-gruppen [data-ersetzen='o2']")), "Büro kann ersetzen");
  await p.screenshot({ path: `${OUT}/d-dokumente.png`, fullPage: true });
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();

  // Studioleitung: nur Onboarding, kein Ersetzen
  const sl = await neueSeite(browser, d, { rpc: rpcFuer(d) });
  await anmelden(sl, "sl@demo.invalid");
  await sl.goto(`${ADRESSE}#akte/d1/dokumente`);
  await sl.waitForSelector("#dokument-gruppen h2");
  pruefe(!(await sl.$("[data-ersetzen]")), "Studioleitung kann nicht ersetzen");
  await sl.click("text=Unterlage hochladen");
  const kat = await sl.$$eval("#hochladen-form [name=kategorie] option", (o) => o.map((x) => x.value));
  pruefe(JSON.stringify(kat) === JSON.stringify(["onboarding"]), `Studioleitung: nur Onboarding (${kat})`);
  pruefe(sl.jsFehler.length === 0, `keine JS-Fehler (${sl.jsFehler.join("; ")})`);
  await sl.close();
}

// Weitere Teile kommen mit den nächsten Aufgaben
const TEILE = [teilUebersicht, teilVerlauf, teilDokumente];

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
