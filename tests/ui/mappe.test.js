// Browser-Test der Unterschriftsmappe mit simulierten Antworten (nur erfundene Demo-Daten).
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/mappe.test.js app /tmp/ui
const { chromium, demoDaten, starteServer, neueSeite, anmelden, pruefer, plus, ADRESSE } = require("./mock.js");

const [APP = "app", OUT = "/tmp/ui"] = process.argv.slice(2);
const { pruefe, ende } = pruefer();
const PNG = "iVBORw0KGgo"; // Anfang einer PNG-Datei in Base64

function demoInhalt(art, titel, zeilen) {
  return { art, kopf: { firma: "DemoFit Steiermark GmbH", adresse: "Musterstraße 1, 8010 Graz" }, titel,
    untertitel: art === "dienstzettel" ? "gemäß § 2 AVRAG" : null,
    felder: [["Arbeitnehmer/in", "Frau Anna Berger"], ["Entgelt", "€ 1.300,00 brutto monatlich"]],
    abschnitte: [{ titel: "Urlaub", text: "Der Urlaubsanspruch richtet sich nach dem Urlaubsgesetz." }],
    unterschrift_zeilen: zeilen };
}

// Mappe mit Dienstzettel + 2 Onboarding-Unterlagen; erledigte Schritte bekommen einen Status
function mappeStand() {
  const s = {
    erledigt: new Set(),
    mappe() {
      const schritt = (key, extra) => (s.erledigt.has(key) ? { ...extra, status: "abgeschlossen", inhalt: undefined, fassung: undefined } : extra);
      return {
        dienstverhaeltnis_id: "d1", organisation_id: "o", name: "Anna Berger", ort: "Leoben", eintritt: plus(0),
        frist: { fruehester: plus(2), verletzt: false, dringend_grund: null },
        schritte: [
          schritt("dz", { art: "dienstzettel", status: "offen", fassung: "f-dz",
            inhalt: demoInhalt("dienstzettel", "DIENSTZETTEL", [{ rolle: "mitarbeiter", beschriftung: "Arbeitnehmer/in" }, { rolle: "arbeitgeber", beschriftung: "Arbeitgeber" }]) }),
          schritt("b1", { art: "onboarding", unterlage_id: "b1", status: "offen", pflicht: true, fassung: "f-b1",
            inhalt: demoInhalt("onboarding", "Einverständnis Stundenaufzeichnung", [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }]) }),
          schritt("b2", { art: "onboarding", unterlage_id: "b2", status: "offen", pflicht: true, fassung: "f-b2",
            inhalt: demoInhalt("onboarding", "Bildaufnahme", [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in" }]) }),
        ],
      };
    },
  };
  return s;
}

async function zeichnen(p) {
  const box = await p.$eval("#unterschrift-feld canvas", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.mouse.move(box.x + 20, box.y + box.h / 2);
  await p.mouse.down();
  for (let i = 0; i <= 60; i++) {
    await p.mouse.move(box.x + 20 + i * 5, box.y + box.h / 2 + Math.sin(i / 3) * 35);
  }
  await p.mouse.up();
}

const meldung = async (p) => (await p.textContent("#mappe-meldung")).trim();

async function teilAblauf(browser) {
  console.log("\n# Mappe: Dienstzettel und Onboarding");
  const d = demoDaten();
  const s = mappeStand();
  const gesendet = [];
  let fristEinmal = true;
  const funktionen = {
    mappe: async (b) => {
      gesendet.push(b);
      await new Promise((r) => setTimeout(r, 150)); // Netz dauert etwas → Doppelklick-Fenster
      if (b.art === "dienstzettel" && fristEinmal) {
        fristEinmal = false;
        return { status: 400, body: { meldung: "Zu kurzfristig. Frühester Dienstantritt ist Donnerstag.", frist: true } };
      }
      s.erledigt.add(b.art === "dienstzettel" ? "dz" : b.unterlage_id);
      return { body: { dokument_id: `neu${gesendet.length}` } };
    },
  };
  const p = await neueSeite(browser, d, { rpc: { mappe_inhalt: () => s.mappe(), mitarbeiter_verzeichnis: () => [] }, funktionen,
    groesse: { width: 1024, height: 768 } });
  await anmelden(p, "sl@demo.invalid");
  await p.goto(`${ADRESSE}#mappe/d1`);
  await p.waitForSelector("#mappe-blatt h2");
  const kopf = (await p.textContent("#seite-mappe")).replace(/\s+/g, " ");
  pruefe(kopf.includes("Anna Berger") && kopf.includes("Schritt 1 von 3"), "Name und Fortschritt");
  pruefe(kopf.includes("DIENSTZETTEL") && kopf.includes("€ 1.300,00") && kopf.includes("Urlaubsgesetz"), "Dienstzettel vollständig sichtbar");
  pruefe(!(await p.$("#mappe-ablehnen:not([hidden])")), "Dienstzettel kann nicht abgelehnt werden");
  await p.screenshot({ path: `${OUT}/m-mappe-quer.png`, fullPage: true });

  await p.click("#mappe-unterschreiben");
  pruefe((await meldung(p)).includes("Bitte bestätigen, dass der Text gelesen wurde."), "ohne Häkchen → Meldung");
  await p.check("#mappe-gelesen");
  await p.click("#mappe-unterschreiben");
  pruefe((await meldung(p)) === "Bitte unterschreiben.", "ohne Zeichnung → „Bitte unterschreiben.“");
  pruefe(gesendet.length === 0, "noch nichts gesendet");

  // Fenstergröße ändern nach dem Zeichnen → Feld leer + Hinweis
  await zeichnen(p);
  await p.setViewportSize({ width: 768, height: 1024 });
  await p.waitForFunction(() => !document.querySelector("#unterschrift-hinweis").hidden);
  pruefe((await p.textContent("#unterschrift-hinweis")).includes("Bitte erneut unterschreiben"), "Größenwechsel: Hinweis");
  await p.click("#mappe-unterschreiben");
  pruefe((await meldung(p)) === "Bitte unterschreiben.", "Größenwechsel: Feld ist leer");
  await p.screenshot({ path: `${OUT}/m-mappe-hoch.png`, fullPage: true });

  // Zeichnen, Doppelklick → nur eine Anfrage; Fristfehler → Grund-Feld
  await zeichnen(p);
  await p.dblclick("#mappe-unterschreiben");
  await p.waitForSelector("#mappe-dringend:not([hidden])");
  pruefe(gesendet.length === 1, `Doppelklick: nur eine Anfrage (${gesendet.length})`);
  const a = gesendet[0];
  pruefe(a.aktion === "mitarbeiter" && a.dienstverhaeltnis_id === "d1" && a.art === "dienstzettel" && a.fassung === "f-dz"
    && a.ergebnis === "unterschrieben" && String(a.png_base64).startsWith(PNG), "Anfrage mit Fassung und PNG");
  pruefe(!("dringend_grund" in a) || !a.dringend_grund, "erste Anfrage ohne Grund");
  pruefe((await meldung(p)).includes("Zu kurzfristig"), "Fristmeldung angezeigt");
  await p.fill("#mappe-dringend textarea", "Krankheitsausfall im Studio");
  await p.click("#mappe-unterschreiben");
  await p.waitForFunction(() => document.querySelector("#seite-mappe").textContent.includes("Schritt 2 von 3"));
  pruefe(gesendet.length === 2 && gesendet[1].dringend_grund === "Krankheitsausfall im Studio"
    && String(gesendet[1].png_base64).startsWith(PNG), "zweite Anfrage mit Grund (Unterschrift bleibt)");

  // Onboarding: Häkchen und Feld sind wieder leer; ablehnen
  pruefe(!(await p.isChecked("#mappe-gelesen")), "neuer Schritt: Häkchen leer");
  pruefe((await p.textContent("#mappe-blatt")).includes("Einverständnis Stundenaufzeichnung"), "Onboarding-Unterlage sichtbar");
  await p.click("#mappe-ablehnen");
  await p.click("#mappe-ablehnen-ja");
  await p.waitForFunction(() => document.querySelector("#seite-mappe").textContent.includes("Schritt 3 von 3"));
  const ab = gesendet[2];
  pruefe(ab.ergebnis === "abgelehnt" && ab.unterlage_id === "b1" && ab.art === "onboarding" && !ab.png_base64, "Ablehnung ohne PNG");

  // Letzter Schritt unterschreiben → Fertig
  await p.check("#mappe-gelesen");
  await zeichnen(p);
  await p.click("#mappe-unterschreiben");
  await p.waitForSelector("#mappe-fertig");
  pruefe((await p.textContent("#mappe-fertig")).includes("Fertig. Alle Unterlagen sind abgelegt."), "Ende: Fertig");
  pruefe(await p.$('#mappe-fertig a[href="#akte/d1/dokumente"]'), "Link zur Akte");
  pruefe(gesendet[3].unterlage_id === "b2" && gesendet[3].ergebnis === "unterschrieben", "letzte Unterlage unterschrieben");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();
}

async function teilFehler(browser) {
  console.log("\n# Mappe: Fehler und Ladezustand");
  const d = demoDaten();
  const p = await neueSeite(browser, d, { rpc: { mappe_inhalt: () => ({ status: 400, body: { message: "Keine Berechtigung für diese Mappe." } }),
    mitarbeiter_verzeichnis: () => [] } });
  await anmelden(p, "sl@demo.invalid");
  await p.goto(`${ADRESSE}#mappe/d9`);
  await p.waitForSelector("#seite-mappe .fehler");
  pruefe((await p.textContent("#seite-mappe .fehler")).includes("Keine Berechtigung"), "Fehler beim Laden sichtbar");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();
}

async function formularFuellen(p, eintritt) {
  await p.selectOption('#dienstzettel [name="funktion"]', "f2");
  await p.selectOption('#dienstzettel [name="standort"]', "s1");
  await p.fill('#dienstzettel [name="eintritt"]', eintritt);
  await p.selectOption('#dienstzettel [name="beschaeftigungsart"]', "teilzeit");
  await p.fill('#dienstzettel [name="wochenstunden"]', "20");
  await p.fill('#dienstzettel [name="arbeitstage"]', "5");
  await p.selectOption('#dienstzettel [name="anrede"]', "Frau");
  for (const [n, v] of [["vorname", "Anna"], ["nachname", "Berger"], ["geburtsdatum", "1995-03-14"], ["strasse", "Probegasse 7"],
    ["plz", "8700"], ["ort", "Leoben"], ["telefon", "+43 660 1111111"], ["email", "anna@demo.invalid"],
    ["staatsangehoerigkeit", "Österreich"], ["netto", "1000"], ["iban", "AT611904300234573201"]]) {
    await p.fill(`#dienstzettel [name="${n}"]`, v);
  }
  await p.check('#dienstzettel [name="sv_nachreichen"]');
}

async function teilFormular(browser) {
  console.log("\n# Dienstzettel: Frist, dringende Anmeldung, Mappe öffnen, „noch nicht angemeldet“");
  const d = demoDaten();
  d.dienstverhaeltnis = [];
  const erfasst = [];
  const p = await neueSeite(browser, d, { rpc: {
    dienstzettel_erfassen: (b) => { erfasst.push(b); return `dvneu${erfasst.length}`; },
    mitarbeiter_verzeichnis: () => [
      { dienstverhaeltnis_id: "d1", mitarbeiter_id: "m1", vorname: "Anna", nachname: "Berger", funktion_id: "f2", standort_id: "s1",
        eintritt: "2026-11-28", austritt: null, erfasst_am: "2026-11-27T17:00:00Z", angemeldet: false },
      { dienstverhaeltnis_id: "d2", mitarbeiter_id: "m2", vorname: "Bernd", nachname: "Huber", funktion_id: "f2", standort_id: "s1",
        eintritt: "2026-10-01", austritt: null, erfasst_am: "2026-09-27T17:00:00Z", angemeldet: true },
    ],
  } });
  await p.clock.setFixedTime(new Date("2026-11-27T17:00:00Z")); // Freitag 18:00 in Wien
  await anmelden(p, "hr@demo.invalid");
  await formularFuellen(p, "2026-11-28");
  await p.click("#speichern");
  const fehlerEintritt = await p.textContent("#fehler-eintritt");
  pruefe(fehlerEintritt.includes("Zu kurzfristig. Frühester Dienstantritt ist Sonntag, 29.11.2026."), `Frist-Meldung am Feld (${fehlerEintritt})`);
  pruefe(erfasst.length === 0, "nicht gespeichert");
  pruefe(await p.$eval("#dringend-grund-feld", (e) => e.hidden), "Grund-Feld erst nach dem Häkchen");
  await p.check('#dienstzettel [name="dringend"]');
  pruefe(!(await p.$("#fehler-eintritt")), "mit „Dringende Anmeldung“ keine Frist-Meldung");
  await p.click("#speichern");
  pruefe((await p.textContent("#fehler-dringend_grund")).includes("Grund"), "Grund ist Pflicht");
  await p.fill('#dienstzettel [name="dringend_grund"]', "Krankheitsausfall im Studio");
  await p.click("#speichern");
  await p.waitForSelector("#gespeichert:not([hidden])");
  pruefe(erfasst[0]?.p_dringend_grund === "Krankheitsausfall im Studio" && erfasst[0]?.p_eintritt === "2026-11-28", "RPC mit Grund");
  pruefe(await p.$('#gespeichert a[href="#mappe/dvneu1"]'), "Knopf „Unterschriftsmappe öffnen“");
  pruefe((await p.textContent("#gespeichert")).includes("Unterschriftsmappe öffnen"), "Knopftext");
  await p.screenshot({ path: `${OUT}/m-gespeichert.png`, fullPage: true });

  // Nächster Mitarbeiter: Vergangenheit und regulärer Termin
  await p.click("#naechster");
  await formularFuellen(p, "2026-11-26");
  await p.click("#speichern");
  pruefe((await p.textContent("#fehler-eintritt")).includes("Vergangenheit"), "Vergangenheit abgelehnt");
  await p.fill('#dienstzettel [name="eintritt"]', "2026-11-29");
  pruefe(!(await p.$eval('#dienstzettel [name="dringend"]', (e) => e.checked)), "Häkchen nach neuem Formular leer");
  await p.click("#speichern");
  await p.waitForSelector("#gespeichert:not([hidden])");
  pruefe(erfasst[1]?.p_dringend_grund === null, "regulär: kein Grund");

  await p.goto(`${ADRESSE}#mitarbeiter`);
  await p.waitForSelector("#liste tr");
  const zeilen = await p.$$eval("#liste tr", (t) => t.map((x) => x.textContent.replace(/\s+/g, " ")));
  pruefe(zeilen.find((z) => z.includes("Berger"))?.includes("noch nicht angemeldet"), "Liste: „noch nicht angemeldet“");
  pruefe(!zeilen.find((z) => z.includes("Huber"))?.includes("noch nicht angemeldet"), "angemeldet: kein Merkmal");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();
}

function kopf(rolle, extra = {}) {
  const buero = ["admin", "geschaeftsfuehrung", "hr"].includes(rolle);
  return { dienstverhaeltnis_id: "d1", mitarbeiter_id: "m1", vorname: "Anna", nachname: "Berger", funktion: "Servicekraft",
    arbeitsort: "DemoFit Leoben", standort_id: "s1", gesellschaft: "DemoFit Steiermark GmbH", eintritt: "2026-11-28", austritt: null,
    befristet_bis: null, angemeldet: false, dringend_grund: "Krankheitsausfall im Studio",
    rechte: { kontakt: true, personendaten: buero, entgelt: buero, lohnverrechnung: buero, dokumente: rolle !== "verwaltung",
      buero, hochladen_onboarding: rolle !== "verwaltung" }, ...extra };
}

async function teilAkte(browser) {
  console.log("\n# Akte: noch nicht angemeldet, dringend, Knopf zur Mappe");
  const d = demoDaten();
  let k = kopf("studioleitung");
  const p = await neueSeite(browser, d, { rpc: { akte_kopf: () => k, onboarding_stand: () => [], mitarbeiter_verzeichnis: () => [] } });
  await p.clock.setFixedTime(new Date("2026-11-27T17:00:00Z"));
  await anmelden(p, "sl@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await p.waitForSelector("#akte-kopf h1");
  const kopfText = (await p.textContent("#akte-kopf")).replace(/\s+/g, " ");
  pruefe(kopfText.includes("noch nicht angemeldet"), "Akte-Kopf: „noch nicht angemeldet“");
  const hinweise = (await p.textContent("#akte-hinweise")).replace(/\s+/g, " ");
  pruefe(hinweise.includes("Dringende Anmeldung: Krankheitsausfall im Studio. Erst arbeiten lassen, wenn „angemeldet“ angezeigt wird."),
    `Hinweis dringende Anmeldung (${hinweise})`);
  pruefe(await p.$('#akte-kopf a[href="#mappe/d1"]'), "Leitung: Knopf „Unterschriftsmappe“");
  await p.screenshot({ path: `${OUT}/m-akte-dringend.png`, fullPage: true });
  await p.close();

  k = kopf("verwaltung", { angemeldet: true, dringend_grund: "Krankheitsausfall im Studio" });
  const v = await neueSeite(browser, d, { rpc: { akte_kopf: () => k, onboarding_stand: () => [], mitarbeiter_verzeichnis: () => [] } });
  await anmelden(v, "verw@demo.invalid");
  await v.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await v.waitForSelector("#akte-kopf h1");
  pruefe(!(await v.$('#akte-kopf a[href="#mappe/d1"]')), "Verwaltung: kein Knopf zur Mappe");
  pruefe(!(await v.textContent("#akte-kopf")).includes("noch nicht angemeldet"), "angemeldet: kein Merkmal");
  pruefe(!(await v.textContent("#akte-hinweise")).includes("Dringende Anmeldung"), "angemeldet: kein Dringend-Hinweis");
  pruefe(v.jsFehler.length === 0, `keine JS-Fehler (${v.jsFehler.join("; ")})`);
  await v.close();
}

function mitAgRecht(d) {
  for (const r of d.rollen_recht) r.darf_arbeitgeber_unterschreiben = ["admin", "geschaeftsfuehrung"].includes(r.rolle);
  return d;
}

async function teilArbeitgeber(browser) {
  console.log("\n# Zu unterschreiben (Arbeitgeber)");
  const d = mitAgRecht(demoDaten());
  let offen = [
    { dokument_id: "z1", dienstverhaeltnis_id: "d1", vorname: "Anna", nachname: "Berger", arbeitsort: "DemoFit Leoben", eintritt: "2026-11-28",
      unterschrieben_am: "2026-11-27T17:30:00Z", dringend_grund: "Krankheitsausfall im Studio", pdf_pfad: "o/d1/vereinbarung/a.pdf" },
    { dokument_id: "z2", dienstverhaeltnis_id: "d2", vorname: "Bernd", nachname: "Huber", arbeitsort: "DemoFit Bruck an der Mur", eintritt: "2026-12-01",
      unterschrieben_am: "2026-11-26T09:00:00Z", dringend_grund: null, pdf_pfad: "o/d2/vereinbarung/b.pdf" },
  ];
  const gesendet = [];
  const rpc = {
    mitarbeiter_verzeichnis: () => [],
    arbeitgeber_offen: () => offen,
    arbeitgeber_inhalt: (b) => ({ dokument_id: b.p_dokument_id, fassung: `f-${b.p_dokument_id}`, organisation_id: "o", dienstverhaeltnis_id: "d1",
      inhalt: demoInhalt("dienstzettel", "DIENSTZETTEL", [{ rolle: "mitarbeiter", beschriftung: "Arbeitnehmer/in" }, { rolle: "arbeitgeber", beschriftung: "Arbeitgeber" }]),
      mitarbeiter: { png_pfad: "o/d1/unterschrift/m.png", ort: "Leoben", datum: "2026-11-27T17:30:00Z" }, arbeitgeber_ort: "Graz" }),
  };
  const funktionen = { mappe: (b) => { gesendet.push(b); offen = offen.filter((x) => x.dokument_id !== b.dokument_id); return { body: { dokument_id: "fertig1" } }; } };

  rpc.offene_punkte = () => [
    { dienstverhaeltnis_id: "d1", vorname: "Anna", nachname: "Berger", standort_id: "s1", art: "dringend", beschreibung: "Dringende Anmeldung: Krankheitsausfall", datum: "2026-11-28" },
    { dienstverhaeltnis_id: "d1", vorname: "Anna", nachname: "Berger", standort_id: "s1", art: "uebermittlung", beschreibung: "Dienstzettel an Lohnverrechner übermitteln", datum: "2026-11-28" },
  ];
  const hr = await neueSeite(browser, d, { rpc, funktionen });
  await anmelden(hr, "hr@demo.invalid");
  pruefe(await hr.$eval('.navigation [data-ziel="unterschreiben"]', (a) => a.hidden), "HR: kein „Zu unterschreiben“");
  await hr.goto(`${ADRESSE}#offen`);
  await hr.waitForSelector("#offen-liste li, #offen-liste tr");
  const arten = await hr.$$eval("#offen-filter [name=art] option", (o) => o.map((x) => x.textContent));
  pruefe(["Dienstzettel fehlt", "Arbeitgeber-Unterschrift fehlt", "An Lohnverrechner übermitteln", "Dringende Anmeldung"].every((a) => arten.includes(a)),
    `Filter „Offene Punkte“ kennt die neuen Arten (${arten.join(", ")})`);
  const offenText = (await hr.textContent("#offen-liste")).replace(/\s+/g, " ");
  pruefe(offenText.includes("Dringende Anmeldung: Krankheitsausfall") && offenText.includes("Dienstzettel an Lohnverrechner übermitteln"),
    "neue Punkte sichtbar");
  await hr.close();

  const p = await neueSeite(browser, d, { rpc, funktionen, groesse: { width: 1024, height: 768 } });
  await anmelden(p, "admin@demo.invalid");
  pruefe(!(await p.$eval('.navigation [data-ziel="unterschreiben"]', (a) => a.hidden)), "Admin: „Zu unterschreiben“ sichtbar");
  await p.click('.navigation [data-ziel="unterschreiben"]');
  await p.waitForSelector("#ag-liste li");
  const eintraege = await p.$$eval("#ag-liste > li", (l) => l.map((x) => x.textContent.replace(/\s+/g, " ")));
  pruefe(eintraege[0].includes("Berger") && eintraege[0].includes("Dringend") && eintraege[0].includes("Krankheitsausfall"), "dringend zuerst, mit Grund");
  pruefe(eintraege[1].includes("Huber") && eintraege[1].includes("Dienstantritt 01.12.2026"), "zweiter Eintrag mit Dienstantritt");
  await p.click('[data-unterschreiben="z1"]');
  await p.waitForSelector("#ag-bereich #mappe-blatt");
  await p.click("#ag-unterschreiben");
  pruefe((await p.textContent("#ag-meldung")).includes("geprüft"), "ohne Häkchen → Meldung");
  await p.check("#ag-geprueft");
  await p.click("#ag-unterschreiben");
  pruefe((await p.textContent("#ag-meldung")) === "Bitte unterschreiben.", "ohne Zeichnung → Meldung");
  await zeichnen(p);
  await p.screenshot({ path: `${OUT}/m-arbeitgeber.png` }); // ohne fullPage: das ändert kurz die Größe und löscht die Unterschrift
  await p.click("#ag-unterschreiben");
  await p.waitForFunction(() => document.querySelectorAll("#ag-liste > li").length === 1);
  pruefe(gesendet.length === 1 && gesendet[0].aktion === "arbeitgeber" && gesendet[0].dokument_id === "z1" && gesendet[0].fassung === "f-z1"
    && String(gesendet[0].png_base64).startsWith(PNG), "Anfrage aktion arbeitgeber mit Dokument und Fassung");
  pruefe((await p.textContent("#ag-status")).includes("Berger"), "Bestätigung nach dem Unterschreiben");
  offen = [];
  await p.goto(`${ADRESSE}#mitarbeiter`);
  await p.goto(`${ADRESSE}#unterschreiben`);
  await p.waitForSelector("#ag-leer:not([hidden])");
  pruefe((await p.textContent("#ag-leer")).includes("Nichts zu unterschreiben."), "leer → „Nichts zu unterschreiben.“");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();
}

async function teilBueroAktionen(browser) {
  console.log("\n# Dokumente: Büro-Aktionen am Dienstzettel");
  const d = demoDaten();
  d.dokument = [
    { id: "x1", dienstverhaeltnis_id: "d1", typ: "dienstzettel", kategorie: "vereinbarung", bezeichnung: "Dienstzettel", status: "abgeschlossen",
      datei_pfad: "o/d1/vereinbarung/x1.pdf", ersetzt_durch: null, neu_angefordert_am: null, papier: false,
      uebermittelt_am: null, ausgehaendigt_am: null, hochgeladen_am: "2026-11-27T18:00:00Z", created_at: "2026-11-27T18:00:00Z" },
    { id: "x0", dienstverhaeltnis_id: "d1", typ: "dienstzettel", kategorie: "vereinbarung", bezeichnung: "Dienstzettel", status: "unterschrieben",
      datei_pfad: "o/d1/vereinbarung/x0.pdf", ersetzt_durch: "x1", neu_angefordert_am: null, papier: false,
      hochgeladen_am: "2026-11-27T17:30:00Z", created_at: "2026-11-27T17:30:00Z" },
  ];
  const aufrufe = [];
  const merken = (name) => (b) => { aufrufe.push({ name, b }); return null; };
  const rpc = {
    mitarbeiter_verzeichnis: () => [], onboarding_stand: () => [],
    akte_kopf: () => kopf("hr", { angemeldet: true }),
    dienstzettel_vermerken: merken("dienstzettel_vermerken"),
    dienstzettel_neu_anfordern: merken("dienstzettel_neu_anfordern"),
    dienstzettel_papier: merken("dienstzettel_papier"),
  };
  const p = await neueSeite(browser, d, { rpc });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/dokumente`);
  await p.waitForSelector('[data-uebermittelt="x1"]');
  pruefe(!(await p.$('[data-ersetzen="x1"]')), "Dienstzettel wird nicht über „Ersetzen“ getauscht");
  await p.click('[data-uebermittelt="x1"]');
  await p.waitForFunction(() => true);
  await p.waitForTimeout(100);
  pruefe(aufrufe.at(-1)?.name === "dienstzettel_vermerken" && aufrufe.at(-1).b.p_dokument_id === "x1" && aufrufe.at(-1).b.p_was === "uebermittelt",
    "„An Lohnverrechner übermittelt“ → RPC");
  await p.waitForSelector('[data-ausgehaendigt="x1"]');
  await p.click('[data-ausgehaendigt="x1"]');
  await p.selectOption("#dz-aktion [name=art]", "email");
  await p.click("#dz-aktion button[type=submit]");
  await p.waitForTimeout(100);
  pruefe(aufrufe.at(-1)?.b.p_was === "ausgehaendigt" && aufrufe.at(-1).b.p_art === "email", "„Ausgehändigt“ per E-Mail → RPC");
  await p.waitForSelector('[data-neu="x1"]');
  const vorher = aufrufe.length;
  await p.click('[data-neu="x1"]');
  await p.click("#dz-aktion button[type=submit]");
  pruefe((await p.textContent("#dz-aktion .fehler")).includes("Grund"), "Neu unterschreiben lassen: Grund ist Pflicht");
  pruefe(aufrufe.length === vorher, "ohne Grund nichts gesendet");
  await p.fill("#dz-aktion [name=grund]", "Adresse falsch");
  await p.click("#dz-aktion button[type=submit]");
  await p.waitForTimeout(100);
  pruefe(aufrufe.at(-1)?.name === "dienstzettel_neu_anfordern" && aufrufe.at(-1).b.p_grund === "Adresse falsch", "neu unterschreiben lassen → RPC");

  // Anzeige: übermittelt, ausgehändigt, Papier, neu angefordert
  Object.assign(d.dokument[0], { uebermittelt_am: "2026-11-28T08:00:00Z", ausgehaendigt_am: "2026-11-28T08:05:00Z", ausgehaendigt_art: "email" });
  d.dokument.push({ id: "x2", dienstverhaeltnis_id: "d2", typ: "dienstzettel", kategorie: "vereinbarung", bezeichnung: "Dienstzettel (Papier)",
    status: "abgeschlossen", datei_pfad: "o/d1/vereinbarung/x2.pdf", ersetzt_durch: null, papier: true, created_at: "2026-11-28T09:00:00Z" });
  d.dokument[2].dienstverhaeltnis_id = "d1";
  await p.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await p.goto(`${ADRESSE}#akte/d1/dokumente`);
  await p.waitForSelector("#dokument-gruppen table");
  const t = (await p.textContent("#dokument-gruppen")).replace(/\s+/g, " ");
  pruefe(t.includes("übermittelt am 28.11.2026") && t.includes("ausgehändigt am 28.11.2026 (E-Mail)"), `Vermerke sichtbar`);
  pruefe(t.includes("Papier (Scan)"), "Papier gekennzeichnet");

  // Papier-Dienstzettel hochladen
  await p.click("#hochladen-oeffnen");
  await p.selectOption("#hochladen-form [name=kategorie]", "dienstzettel_papier");
  pruefe(await p.$eval("#hochladen-form [name=bezeichnung]", (e) => e.closest("label").hidden), "Papier: keine Bezeichnung nötig");
  await p.setInputFiles("#hochladen-form [name=datei]", { name: "dz.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await p.click("#hochladen-form button[type=submit]");
  await p.waitForTimeout(200);
  const pap = aufrufe.find((a) => a.name === "dienstzettel_papier");
  pruefe(pap && /^o\/d1\/vereinbarung\//.test(pap.b.p_pfad) && pap.b.p_dienstverhaeltnis_id === "d1" && /^[0-9a-f]{64}$/.test(pap.b.p_hash),
    "Papier-Dienstzettel → dienstzettel_papier");
  pruefe(!p.anfragen.some((a) => a.pfad === "/rest/v1/rpc/dokument_ablegen"), "nicht über dokument_ablegen");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();
}

(async () => {
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const teil of [teilAblauf, teilFehler, teilFormular, teilAkte, teilArbeitgeber, teilBueroAktionen]) await teil(browser);
  } catch (e) {
    pruefe(false, `Abbruch: ${e.message.split("\n").slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
    server.close();
  }
  ende("Mappe-Tests bestanden");
})();
