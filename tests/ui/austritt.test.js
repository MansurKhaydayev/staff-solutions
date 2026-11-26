// Browser-Tests: Austritt melden, bestätigen, korrigieren, Sammelmail an den Lohnverrechner,
// Mitarbeiterliste nach Status und Einstellungen. Nur erfundene Demo-Daten.
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/austritt.test.js app /tmp/ui
const { chromium, starteServer, neueSeite, anmelden, pruefer, plus, ADRESSE } = require("./mock.js");
const { daten, kopfFuer, rpcFuer, inhalt, at } = require("./akte.test.js");

const [APP = "app", OUT = "/tmp/ui"] = process.argv.slice(2);
const { pruefe, ende } = pruefer();

const ARTEN = [
  ["probezeit", "Lösung in der Probezeit"], ["kuendigung_an", "Kündigung durch Arbeitnehmer"],
  ["einvernehmlich", "Einvernehmliche Auflösung"], ["sonstiges", "Sonstiges"],
];

function austrittDaten() {
  const d = daten();
  d.organisation[0].abmeldefrist_tage = 7;
  d.organisation[0].buero_email = "personal@demo.invalid";
  d.austrittsart = ARTEN.map(([schluessel, bezeichnung], i) => ({ id: `aa${i}`, organisation_id: "o", schluessel, bezeichnung,
    reihenfolge: i + 1, aktiv: true }));
  d.status = { status: "aktiv", meldung_id: null, abmeldung_bis: null };
  d.verlauf = [];
  return d;
}

// akte_kopf mit Status-Feldern aus dem Austritts-Ablauf
function rpcAustritt(d, extra = {}) {
  return rpcFuer(d, {
    akte_kopf: (b, p) => {
      const k = { ...kopfFuer(d, p.rolle), ...d.status, austritt: d.status.austritt || null };
      const r = d.rollen_recht.find((x) => x.rolle === p.rolle);
      k.rechte.austritt_melden = k.rechte.buero || r.darf_anlegen;
      return k;
    },
    austritt_verlauf: () => d.verlauf,
    ...extra,
  });
}

// ---------------------------------------------------------------- Akte: melden
async function teilMelden(browser) {
  console.log("\n# Leitung meldet Austritt");
  const d = austrittDaten();
  const gemeldet = [];
  const rpc = rpcAustritt(d, {
    austritt_melden: (b) => {
      gemeldet.push(b);
      d.status = { status: "austritt_gemeldet", meldung_id: "am1", abmeldung_bis: null };
      d.verlauf = [{ id: "am1", art: "austritt", letzter_arbeitstag: b.p_letzter_arbeitstag, austrittsart: null, austrittsart_text: null,
        notiz: null, gemeldet_von_email: "sl@demo.invalid", gemeldet_am: `${plus(0)}T08:00:00Z`, bestaetigt_von_email: null,
        bestaetigt_am: null, abweichung: null, zurueckgenommen: false, korrektur_grund: null, ersetzt: false }];
      return "am1";
    },
  });
  const p = await neueSeite(browser, d, { rpc });
  await anmelden(p, "sl@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await p.waitForSelector("#austritt-melden");
  pruefe(Boolean(await p.$("#nicht-angetreten")), "Knopf „Nicht angetreten“ ab Dienstantritt sichtbar");
  pruefe(!(await p.$("#austritt-bestaetigen")), "Leitung sieht keinen Knopf „Bestätigen“");
  pruefe(Boolean(await p.$('#akte-austritt a[href^="mailto:personal@demo.invalid"]')), "Rückfrage ans Büro als Mail-Link");
  await p.click("#austritt-melden");
  await p.waitForSelector("#austritt-form");
  await p.click("#austritt-form button[type=submit]");
  pruefe((await inhalt(p, "#austritt-form .fehler")) === "Bitte den letzten Arbeitstag angeben.", "Pflicht: letzter Arbeitstag");
  await p.fill("#austritt-form [name=tag]", plus(10));
  await p.click("#austritt-form button[type=submit]");
  pruefe((await inhalt(p, "#austritt-form .fehler")) === "Bitte die Art des Austritts wählen.", "Pflicht: Art");
  const optionen = await p.$$eval("#austritt-form [name=austrittsart] option", (o) => o.map((x) => x.textContent));
  pruefe(optionen.includes("Kündigung durch Arbeitnehmer"), "Austrittsarten aus den Einstellungen");
  await p.selectOption("#austritt-form [name=austrittsart]", "kuendigung_an");
  await p.fill("#austritt-form [name=notiz]", "Umzug");
  await p.click("#austritt-form button[type=submit]");
  await p.waitForSelector("#akte-kopf >> text=Austritt gemeldet");
  pruefe(gemeldet[0]?.p_art === "austritt" && gemeldet[0]?.p_letzter_arbeitstag === plus(10)
    && gemeldet[0]?.p_austrittsart === "kuendigung_an" && gemeldet[0]?.p_notiz === "Umzug" && !gemeldet[0]?.p_gleich_bestaetigen,
  `Meldung gesendet (${JSON.stringify(gemeldet[0])})`);
  pruefe(!(await p.$("#austritt-melden")), "nach der Meldung kein zweiter Knopf „Austritt melden“");
  pruefe((await inhalt(p, "#akte-austritt")).includes("gemeldet von sl@demo.invalid"), "Verlauf zeigt die Meldung");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.screenshot({ path: `${OUT}/au-gemeldet.png`, fullPage: true });
  await p.close();

  console.log("\n# Nicht angetreten: erst ab Dienstantritt, Grund Pflicht");
  const d2 = austrittDaten();
  d2.dienstverhaeltnis[0].eintritt = plus(5);
  const rpc2 = rpcAustritt(d2, { akte_kopf: (b, pg) => ({ ...rpcAustritt(d2).akte_kopf(b, pg), eintritt: plus(5) }) });
  const q = await neueSeite(browser, d2, { rpc: rpc2 });
  await anmelden(q, "sl@demo.invalid");
  await q.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await q.waitForSelector("#austritt-melden");
  pruefe(!(await q.$("#nicht-angetreten")), "vor dem Dienstantritt kein Knopf „Nicht angetreten“");
  await q.close();

  const d3 = austrittDaten();
  const n = [];
  const r = await neueSeite(browser, d3, { rpc: rpcAustritt(d3, { austritt_melden: (b) => { n.push(b); return "am9"; } }) });
  await anmelden(r, "sl@demo.invalid");
  await r.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await r.click("#nicht-angetreten");
  await r.waitForSelector("#austritt-form");
  pruefe(!(await r.isVisible("#austritt-form [name=tag]")), "bei „nicht angetreten“ kein Datum");
  await r.click("#austritt-form button[type=submit]");
  pruefe((await inhalt(r, "#austritt-form .fehler")) === "Bitte einen Grund angeben.", "Grund ist Pflicht");
  await r.fill("#austritt-form [name=notiz]", "Nicht erschienen");
  await r.click("#austritt-form button[type=submit]");
  await r.waitForSelector("#austritt-form", { state: "detached" });
  pruefe(n[0]?.p_art === "nicht_angetreten" && n[0]?.p_notiz === "Nicht erschienen" && !n[0]?.p_letzter_arbeitstag, "„Nicht angetreten“ gesendet");
  await r.close();

  console.log("\n# Verwaltung (ohne Recht „anlegen“) sieht keine Knöpfe");
  const v = await neueSeite(browser, austrittDaten(), { rpc: rpcAustritt(austrittDaten()) });
  await anmelden(v, "verw@demo.invalid");
  await v.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await v.waitForSelector("#akte-kopf h1");
  await v.waitForTimeout(150);
  pruefe(!(await v.$("#austritt-melden")) && !(await v.$("#nicht-angetreten")), "keine Melde-Knöpfe ohne Recht");
  await v.close();
}

// ---------------------------------------------------------------- Akte: bestätigen und korrigieren
async function teilBestaetigen(browser) {
  console.log("\n# Büro bestätigt mit anderem Datum, PDF wird erzeugt");
  const d = austrittDaten();
  d.status = { status: "austritt_gemeldet", meldung_id: "am1", abmeldung_bis: null };
  const alt = { id: "am1", art: "austritt", letzter_arbeitstag: plus(10), austrittsart: "kuendigung_an",
    austrittsart_text: "Kündigung durch Arbeitnehmer", notiz: "Umzug", gemeldet_von_email: "sl@demo.invalid",
    gemeldet_am: `${plus(-1)}T08:00:00Z`, bestaetigt_von_email: null, bestaetigt_am: null, abweichung: null,
    zurueckgenommen: false, korrektur_grund: null, ersetzt: false };
  d.verlauf = [alt];
  const best = [];
  const pdf = [];
  const rpc = rpcAustritt(d, {
    austritt_bestaetigen: (b) => {
      best.push(b);
      d.status = { status: "austritt_bestaetigt", meldung_id: "am2", abmeldung_bis: plus(19), austritt: b.p_letzter_arbeitstag };
      d.verlauf = [{ ...alt, ersetzt: true }, { ...alt, id: "am2", letzter_arbeitstag: b.p_letzter_arbeitstag, bestaetigt_von_email: "hr@demo.invalid",
        bestaetigt_am: `${plus(0)}T09:00:00Z`, abweichung: `Letzter Arbeitstag ${at(b.p_letzter_arbeitstag)} statt ${at(plus(10))}` }];
      return "am2";
    },
  });
  const p = await neueSeite(browser, d, { rpc, funktionen: { mappe: (b) => { pdf.push(b); return { body: "dok1" }; } } });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await p.waitForSelector("#austritt-bestaetigen");
  const kopf = await inhalt(p, "#akte-kopf");
  pruefe(kopf.includes("Austritt gemeldet"), `Kopf zeigt „Austritt gemeldet“ (${kopf})`);
  pruefe(Boolean(await p.$("#akte-kopf .merkmal-frist")), "Etikett gelb");
  pruefe(!(await p.$("#austritt-melden")), "kein zweites Melden");
  await p.click("#austritt-bestaetigen");
  await p.waitForSelector("#austritt-form");
  pruefe(await p.inputValue("#austritt-form [name=tag]") === plus(10), "Datum vorbelegt");
  pruefe(await p.inputValue("#austritt-form [name=austrittsart]") === "kuendigung_an", "Art vorbelegt");
  await p.fill("#austritt-form [name=tag]", plus(12));
  await p.click("#austritt-form button[type=submit]");
  await p.waitForSelector("#akte-kopf >> text=Austritt am");
  pruefe(best[0]?.p_meldung_id === "am1" && best[0]?.p_letzter_arbeitstag === plus(12) && best[0]?.p_austrittsart === "kuendigung_an",
    `Bestätigung gesendet (${JSON.stringify(best[0])})`);
  pruefe(pdf[0]?.aktion === "meldung" && pdf[0]?.meldung_id === "am2", `Meldungs-PDF erzeugt (${JSON.stringify(pdf[0])})`);
  const verlauf = await inhalt(p, "#akte-austritt");
  pruefe((await p.$$("#akte-austritt .verlauf-ersetzt")).length === 1, "alte Fassung durchgestrichen");
  pruefe(verlauf.includes(`Letzter Arbeitstag ${at(plus(12))} statt ${at(plus(10))}`), "Abweichung im Verlauf");
  pruefe(verlauf.includes("Kündigung durch Arbeitnehmer") && verlauf.includes("Umzug"), "Art und Notiz mit Personendaten sichtbar");
  pruefe((await inhalt(p, "#akte-kopf")).includes(`Austritt am ${at(plus(12))}`), "Kopf: Austritt am …");
  pruefe(Boolean(await p.$("#austritt-korrigieren")), "Knopf „Korrigieren“");
  await p.screenshot({ path: `${OUT}/au-bestaetigt.png`, fullPage: true });

  console.log("\n# Korrigieren: Grund Pflicht, zurücknehmen");
  const korr = [];
  rpc.austritt_korrigieren = (b) => { korr.push(b); d.status = { status: "aktiv", meldung_id: null, abmeldung_bis: null }; return "am3"; };
  await p.click("#austritt-korrigieren");
  await p.waitForSelector("#austritt-form");
  await p.click("#austritt-form button[type=submit]");
  pruefe((await inhalt(p, "#austritt-form .fehler")) === "Bitte einen Grund angeben.", "Korrigieren ohne Grund abgelehnt");
  await p.check("#austritt-form [name=zuruecknehmen]");
  await p.fill("#austritt-form [name=grund]", "Bleibt doch");
  await p.click("#austritt-form button[type=submit]");
  await p.waitForSelector("#austritt-melden");
  pruefe(korr[0]?.p_meldung_id === "am2" && korr[0]?.p_grund === "Bleibt doch" && korr[0]?.p_zuruecknehmen === true,
    `Zurücknehmen gesendet (${JSON.stringify(korr[0])})`);
  pruefe(pdf.length === 2 && pdf[1].meldung_id === "am3", "nach der Korrektur wird das Korrektur-PDF versucht");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();

  console.log("\n# PDF schlägt fehl → Hinweis");
  const d2 = austrittDaten();
  d2.status = { status: "austritt_gemeldet", meldung_id: "am1", abmeldung_bis: null };
  d2.verlauf = [alt];
  const q = await neueSeite(browser, d2, {
    rpc: rpcAustritt(d2, { austritt_bestaetigen: () => { d2.status = { status: "austritt_bestaetigt", meldung_id: "am1", abmeldung_bis: plus(-1), austritt: plus(-8) }; return "am1"; } }),
    funktionen: { mappe: () => ({ status: 500, body: { meldung: "kaputt" } }) },
  });
  await anmelden(q, "hr@demo.invalid");
  await q.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await q.click("#austritt-bestaetigen");
  await q.click("#austritt-form button[type=submit]");
  await q.waitForSelector("#akte-austritt >> text=Das PDF konnte nicht erstellt werden");
  pruefe((await inhalt(q, "#akte-austritt")).includes("Unter „An Lohnverrechner übermitteln“ erneut versuchen."), "Hinweis bei PDF-Fehler");
  pruefe(Boolean(await q.$("#akte-kopf .merkmal-fehlt")), "abgelaufene Abmeldefrist rot");
  await q.close();

  console.log("\n# Büro meldet und bestätigt in einem Schritt");
  const d3 = austrittDaten();
  const g = [];
  const r = await neueSeite(browser, d3, { rpc: rpcAustritt(d3, { austritt_melden: (b) => { g.push(b); return "am5"; } }),
    funktionen: { mappe: () => ({ body: "dok" }) } });
  await anmelden(r, "hr@demo.invalid");
  await r.goto(`${ADRESSE}#akte/d1/uebersicht`);
  await r.click("#austritt-melden");
  pruefe(await r.isChecked("#austritt-form [name=gleich]"), "Büro: „gleich bestätigen“ vorausgewählt");
  await r.fill("#austritt-form [name=tag]", plus(3));
  await r.selectOption("#austritt-form [name=austrittsart]", "einvernehmlich");
  await r.click("#austritt-form button[type=submit]");
  await r.waitForSelector("#austritt-form", { state: "detached" });
  pruefe(g[0]?.p_gleich_bestaetigen === true, "gleich bestätigt");
  await r.close();

  console.log("\n# Status-Etiketten");
  for (const [status, erwartet, klasse] of [["storno_ausstaendig", "Storno ausständig", "merkmal-fehlt"],
    ["nicht_angetreten", "nicht angetreten", "merkmal-aus"], ["abgemeldet", "abgemeldet", "merkmal-aus"]]) {
    const ds = austrittDaten();
    ds.status = { status, meldung_id: "x", abmeldung_bis: null, austritt: status === "abgemeldet" ? plus(-3) : null };
    const s = await neueSeite(browser, ds, { rpc: rpcAustritt(ds) });
    await anmelden(s, "hr@demo.invalid");
    await s.goto(`${ADRESSE}#akte/d1/uebersicht`);
    await s.waitForSelector(`#akte-kopf .${klasse}`);
    pruefe((await inhalt(s, "#akte-kopf")).includes(erwartet), `Etikett „${erwartet}“`);
    pruefe(!(await s.$('#akte-kopf a[href^="#mappe"]')), `${status}: keine Unterschriftsmappe`);
    await s.close();
  }
}

// ---------------------------------------------------------------- Offene Punkte: Sammelmail
function uebermittlungDaten() {
  const d = austrittDaten();
  const f = (lv, name, email, dv, vorname, nachname, art, dok, datum, meld = null) => ({ lohnverrechner_id: lv, lohnverrechner_name: name,
    lohnverrechner_email: email, dienstverhaeltnis_id: dv, vorname, nachname, gesellschaft: "DemoFit Steiermark GmbH", art,
    dokument_id: dok, meldung_id: meld, datum });
  d.offen = [
    f("c1", "Demo Lohnbüro", "lohn@demo.invalid", "d1", "Anna", "Berger", "anmeldung", "x1", plus(-2)),
    f("c1", "Demo Lohnbüro", "lohn@demo.invalid", "d2", "Đorđe", "Đorđević", "abmeldung", "x2", plus(-1), "am7"),
    f("c1", "Demo Lohnbüro", "lohn@demo.invalid", "d3", "Lea", "Moser", "storno", null, plus(-1), "am8"),
    f("c2", "Demo Lohnbüro Wien", null, "d4", "Max", "Muster", "anmeldung", "x4", plus(1)),
  ];
  d.dokument.push(
    { id: "x1", dienstverhaeltnis_id: "d1", kategorie: "anmeldung", datei_pfad: "o/d1/anmeldung/x1.pdf" },
    { id: "x2", dienstverhaeltnis_id: "d2", kategorie: "abmeldung", datei_pfad: "o/d2/abmeldung/x2.pdf" },
    { id: "x4", dienstverhaeltnis_id: "d4", kategorie: "anmeldung", datei_pfad: "o/d4/anmeldung/x4.pdf" },
  );
  return d;
}

async function teilUebermittlung(browser) {
  console.log("\n# Sammelmail je Lohnverrechner");
  const d = uebermittlungDaten();
  const vermerkt = [];
  const erzeugt = [];
  const punkte = [
    { dienstverhaeltnis_id: "d2", vorname: "Đorđe", nachname: "Đorđević", standort_id: "s1", art: "abmeldung",
      beschreibung: `Abmeldung übermitteln bis ${at(plus(-1))}`, datum: plus(-1) },
    { dienstverhaeltnis_id: "d1", vorname: "Anna", nachname: "Berger", standort_id: "s1", art: "austritt_bestaetigen",
      beschreibung: "Austritt bestätigen", datum: plus(10) },
  ];
  const rpc = rpcAustritt(d, {
    offene_punkte: () => punkte,
    uebermittlung_offen: () => d.offen,
    uebermittlung_vermerken: (b) => { vermerkt.push(b); d.offen = d.offen.filter((x) => !b.p_dokument_ids.includes(x.dokument_id));
      return [{ sammelversand_id: "sv1", lohnverrechner_id: "c1", vermerkt: b.p_dokument_ids.length }]; },
  });
  const p = await neueSeite(browser, d, { rpc, funktionen: { mappe: (b) => { erzeugt.push(b);
    d.offen = d.offen.map((x) => (x.meldung_id === b.meldung_id ? { ...x, dokument_id: "x3" } : x));
    d.dokument.push({ id: "x3", dienstverhaeltnis_id: "d3", kategorie: "storno", datei_pfad: "o/d3/storno/x3.pdf" });
    return { body: "x3" }; } } });
  await p.addInitScript(() => {
    window.__mail = [];
    // Mailprogramm im Test nicht wirklich öffnen
    window.__mailOeffnen = (link) => window.__mail.push(link);
  });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#offen`);
  await p.waitForSelector("#uebermittlung .lv-bereich");
  pruefe((await p.$$("#uebermittlung .lv-bereich")).length === 2, "zwei Lohnverrechner-Bereiche");
  const text = await inhalt(p, "#uebermittlung");
  pruefe(text.includes("Demo Lohnbüro") && text.includes("Đorđević Đorđe") && text.includes("Abmeldung"), "Fälle aufgelistet");
  pruefe(text.includes("Für diesen Lohnverrechner ist keine E-Mail-Adresse hinterlegt (Einstellungen)."), "Hinweis ohne E-Mail");
  pruefe(await p.$eval('[data-lv="c2"] [data-aktion=senden]', (k) => k.disabled), "Mail-Knopf ohne Adresse gesperrt");
  pruefe((await p.$$('[data-lv="c1"] input[type=checkbox]:checked')).length === 2, "Fälle mit PDF vorab angehakt");
  pruefe(Boolean(await p.$('[data-lv="c1"] [data-erzeugen="am8"]')), "Zeile ohne PDF: „PDF erzeugen“");

  await p.click('[data-lv="c1"] [data-erzeugen="am8"]');
  await p.waitForSelector('[data-lv="c1"] input[value="x3"]');
  pruefe(erzeugt[0]?.aktion === "meldung" && erzeugt[0]?.meldung_id === "am8", "PDF erzeugen ruft die Edge Function");
  pruefe((await p.$$('[data-lv="c1"] input[type=checkbox]:checked')).length === 3, "danach alle drei angehakt");

  await p.click('[data-lv="c1"] [data-aktion=senden]');
  await p.waitForSelector("#uebermittlung-dialog .gespeichert-liste li");
  const dialog = await inhalt(p, "#uebermittlung-dialog");
  pruefe(dialog.includes("Gespeichert im Ordner Downloads (am iPad: Dateien-App → Downloads):"), "Ort der Dateien genannt");
  pruefe(dialog.includes(`${plus(0)}_Demo-Lohnbuero_Abmeldung_Dordevic-Dorde.pdf`), `Dateiname mit Sonderzeichen (${dialog.slice(0, 300)})`);
  pruefe(dialog.includes(`${plus(0)}_Demo-Lohnbuero_Anmeldung_Berger-Anna.pdf`), "Dateiname Anmeldung");
  const mail = await p.evaluate(() => window.__mail);
  pruefe(mail.length === 1 && mail[0].startsWith("mailto:lohn%40demo.invalid?subject=") &&
    decodeURIComponent(mail[0]).includes("Staff-Solutions: 1 Anmeldung, 1 Abmeldung, 1 Storno"), `Mail-Link mit Betreff (${mail[0]?.slice(0, 120)})`);
  pruefe(Boolean(await p.$('#uebermittlung-dialog a[href^="mailto:"]')), "Mail kann erneut geöffnet werden");
  await p.screenshot({ path: `${OUT}/au-sammelmail.png`, fullPage: true });

  await p.click("#gesendet-nein");
  pruefe(vermerkt.length === 0, "„Nein“ ändert nichts");
  pruefe((await p.$$('[data-lv="c1"] tr')).length >= 3, "Fälle bleiben auf der Liste");

  await p.click('[data-lv="c1"] [data-aktion=senden]');
  await p.waitForSelector("#gesendet-ja");
  await p.click("#gesendet-ja");
  await p.waitForSelector("#uebermittlung-status >> text=als übermittelt vermerkt");
  pruefe(JSON.stringify([...(vermerkt[0]?.p_dokument_ids || [])].sort()) === JSON.stringify(["x1", "x2", "x3"]), `„Ja“ vermerkt die angehakten (${JSON.stringify(vermerkt[0])})`);
  pruefe((await inhalt(p, "#uebermittlung-status")) === "3 Fälle als übermittelt vermerkt.", "Meldung nach dem Vermerken");
  pruefe((await p.$$("#uebermittlung .lv-bereich")).length === 1, "Liste neu geladen");

  const offen = await inhalt(p, "#offen-liste");
  pruefe(offen.includes(`Abmeldung übermitteln bis ${at(plus(-1))}`) && offen.includes("Austritt bestätigen"), "neue offene Punkte");
  pruefe(Boolean(await p.$("#offen-liste .punkt-ueberfaellig")), "abgelaufene Abmeldefrist rot");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();

  console.log("\n# Leitung sieht den Bereich nicht");
  const l = await neueSeite(browser, d, { rpc });
  await anmelden(l, "sl@demo.invalid");
  await l.goto(`${ADRESSE}#offen`);
  await l.waitForSelector("#offen-leer, #offen-liste .offen-person");
  pruefe(!(await l.isVisible("#uebermittlung")), "Studioleitung: kein Bereich „An Lohnverrechner übermitteln“");
  await l.close();
}

// ---------------------------------------------------------------- Mitarbeiterliste
async function teilListe(browser) {
  console.log("\n# Liste: Aktive, Ein- und Austritte, Ehemalige");
  const d = austrittDaten();
  const zeile = (id, vorname, nachname, eintritt, austritt) => ({ dienstverhaeltnis_id: id, mitarbeiter_id: `m${id}`, vorname, nachname,
    funktion_id: "f2", standort_id: "s1", eintritt, austritt, erfasst_am: `${eintritt}T10:00:00Z`, telefon: null, email: null,
    beschaeftigungsart: "teilzeit", wochenstunden: 20, befristet_bis: null });
  const liste = [
    zeile("d1", "Anna", "Berger", plus(-100), null),
    zeile("d2", "Bernd", "Gruber", plus(-200), plus(-3)),
    zeile("d3", "Clara", "Moser", plus(-2), null),
    zeile("d4", "Dora", "Neu", plus(-4), null),
    zeile("d5", "Emil", "Alt", plus(-400), plus(-60)),
    zeile("d6", "Franz", "Geht", plus(-300), plus(5)),
  ];
  const status = [
    { dienstverhaeltnis_id: "d1", status: "aktiv", austritt: null },
    { dienstverhaeltnis_id: "d2", status: "abgemeldet", austritt: plus(-3) },
    { dienstverhaeltnis_id: "d3", status: "nicht_angetreten", austritt: null },
    { dienstverhaeltnis_id: "d4", status: "aktiv", austritt: null },
    { dienstverhaeltnis_id: "d5", status: "abgemeldet", austritt: plus(-60) },
    { dienstverhaeltnis_id: "d6", status: "austritt_bestaetigt", austritt: plus(5) },
  ];
  const rpc = rpcAustritt(d, { mitarbeiter_verzeichnis: () => liste, mitarbeiter_status: () => status });
  const p = await neueSeite(browser, d, { rpc });
  await anmelden(p, "verw@demo.invalid");
  await p.goto(`${ADRESSE}#mitarbeiter`);
  await p.waitForSelector("#liste tr");
  const namen = async () => (await p.$$eval("#liste a.name", (a) => a.map((x) => x.textContent))).sort();
  pruefe(JSON.stringify(await namen()) === JSON.stringify(["Berger Anna", "Geht Franz", "Neu Dora"]), `Aktive (${await namen()})`);
  pruefe((await inhalt(p, "#liste")).includes(`Austritt am ${at(plus(5))}`), "bestätigter Austritt als Etikett");
  await p.selectOption("#filter [name=status]", "einaus");
  pruefe(await p.isVisible("#filter [name=von]"), "Zeitraum sichtbar");
  pruefe(await p.inputValue("#filter [name=von]") === plus(-7) && await p.inputValue("#filter [name=bis]") === plus(0), "Voreinstellung letzte 7 Tage");
  pruefe(JSON.stringify(await namen()) === JSON.stringify(["Gruber Bernd", "Neu Dora"]), `Ein- und Austritte ohne „nicht angetreten“ (${await namen()})`);
  const t = await inhalt(p, "#liste");
  pruefe(t.includes("abgemeldet") && t.includes(`Austritt ${at(plus(-3))}`), `Austritt mit Datum (${t.slice(0, 200)})`);
  pruefe(!(await p.$("#liste-kopf >> text=Arbeitszeit")), "Verwaltung: keine Arbeitszeit-Spalte");
  await p.fill("#filter [name=von]", plus(-90));
  await p.dispatchEvent("#filter [name=von]", "change");
  pruefe((await namen()).includes("Alt Emil"), "Zeitraum lässt sich ändern");
  await p.selectOption("#filter [name=status]", "alle");
  pruefe((await namen()).length === 6, "Alle inkl. ehemalige");
  pruefe((await inhalt(p, "#liste")).includes("nicht angetreten"), "Etikett „nicht angetreten“");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.screenshot({ path: `${OUT}/au-liste.png`, fullPage: true });
  await p.close();
}

// ---------------------------------------------------------------- Einstellungen
async function teilEinstellungen(browser) {
  console.log("\n# Einstellungen: Abmeldefrist, Mail-Adressen, Austrittsarten");
  const d = austrittDaten();
  d.lohnverrechner = [{ id: "c1", organisation_id: "o", name: "Demo Lohnbüro", email: "lohn@demo.invalid" },
    { id: "c2", organisation_id: "o", name: "Demo Lohnbüro Wien", email: null }];
  d.textbaustein = []; d.onboarding_unterlage = [];
  const p = await neueSeite(browser, d, { rpc: rpcAustritt(d, { analyse_rechte: () => [] }) });
  await anmelden(p, "admin@demo.invalid");
  await p.goto(`${ADRESSE}#einstellungen`);
  await p.waitForSelector("#austrittsarten-einstellungen input");
  pruefe(await p.inputValue("#austritt-regeln [name=abmeldefrist_tage]") === "7", "Abmeldefrist geladen");
  pruefe(await p.inputValue("#austritt-regeln [name=buero_email]") === "personal@demo.invalid", "Büro-Adresse geladen");
  await p.fill("#austritt-regeln [name=abmeldefrist_tage]", "0");
  await p.click("#austritt-regeln button[type=submit]");
  pruefe((await inhalt(p, "#einstellungen-status")) === "Bitte 1 bis 30 Tage eingeben.", "Abmeldefrist 0 abgelehnt");
  await p.fill("#austritt-regeln [name=abmeldefrist_tage]", "10");
  await p.fill("#austritt-regeln [name=buero_email]", "kein-at-zeichen");
  await p.click("#austritt-regeln button[type=submit]");
  pruefe((await inhalt(p, "#einstellungen-status")) === "Bitte eine gültige E-Mail-Adresse eingeben.", "ungültige Adresse abgelehnt");
  await p.fill("#austritt-regeln [name=buero_email]", "buero@demo.invalid");
  await p.click("#austritt-regeln button[type=submit]");
  await p.waitForSelector("#einstellungen-status >> text=gespeichert");
  pruefe(d.organisation[0].abmeldefrist_tage === 10 && d.organisation[0].buero_email === "buero@demo.invalid", "Organisation gespeichert");

  await p.fill('#lohnverrechner-einstellungen [data-id="c2"]', "falsch");
  await p.dispatchEvent('#lohnverrechner-einstellungen [data-id="c2"]', "change");
  pruefe((await inhalt(p, "#einstellungen-status")) === "Bitte eine gültige E-Mail-Adresse eingeben.", "Lohnverrechner: ungültige Adresse");
  await p.fill('#lohnverrechner-einstellungen [data-id="c2"]', "lohn-wien@demo.invalid");
  await p.dispatchEvent('#lohnverrechner-einstellungen [data-id="c2"]', "change");
  await p.waitForSelector("#einstellungen-status >> text=Gespeichert: Demo Lohnbüro Wien");
  pruefe(d.lohnverrechner[1].email === "lohn-wien@demo.invalid", "Lohnverrechner-Adresse gespeichert");

  await p.fill('#austrittsarten-einstellungen [data-id="aa3"][data-feld="bezeichnung"]', "Anderer Grund");
  await p.dispatchEvent('#austrittsarten-einstellungen [data-id="aa3"][data-feld="bezeichnung"]', "change");
  await p.waitForSelector("#einstellungen-status >> text=Gespeichert: Anderer Grund");
  pruefe(d.austrittsart[3].bezeichnung === "Anderer Grund", "Austrittsart umbenannt");
  await p.uncheck('#austrittsarten-einstellungen [data-id="aa0"][data-feld="aktiv"]');
  await p.waitForTimeout(150);
  pruefe(d.austrittsart[0].aktiv === false, "Austrittsart deaktiviert (nicht gelöscht)");
  pruefe(!(await p.$("#austrittsarten-einstellungen >> text=Löschen")), "kein Löschen-Knopf");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.screenshot({ path: `${OUT}/au-einstellungen.png`, fullPage: true });
  await p.close();
}

// ---------------------------------------------------------------- Dokumente: Storno hochladen, Abschrift aushändigen
async function teilDokumente(browser) {
  console.log("\n# Dokumente: Kategorie Storno, Abschrift der Abmeldung");
  const d = austrittDaten();
  d.dokument.push(
    { id: "ab1", dienstverhaeltnis_id: "d1", kategorie: "abmeldung", typ: null, bezeichnung: "Abmeldebestätigung",
      datei_pfad: "o/d1/abmeldung/ab1.pdf", ersetzt_durch: null, ausgehaendigt_am: null, created_at: `${plus(-1)}T09:00:00Z` },
    { id: "am-pdf", dienstverhaeltnis_id: "d1", kategorie: "abmeldung", typ: "austrittsmeldung", bezeichnung: "Austrittsmeldung",
      datei_pfad: "o/d1/abmeldung/am.pdf", ersetzt_durch: null, ausgehaendigt_am: null, created_at: `${plus(-2)}T09:00:00Z` },
  );
  const aus = [];
  const rpc = rpcAustritt(d, { abmeldung_aushaendigen: (b) => {
    aus.push(b);
    const x = d.dokument.find((y) => y.id === b.p_dokument_id);
    x.ausgehaendigt_am = `${plus(0)}T10:00:00Z`; x.ausgehaendigt_art = b.p_art;
    return null;
  } });
  const p = await neueSeite(browser, d, { rpc });
  await anmelden(p, "hr@demo.invalid");
  await p.goto(`${ADRESSE}#akte/d1/dokumente`);
  await p.waitForSelector("#dokument-gruppen table");
  pruefe((await p.$$("[data-abschrift]")).length === 1, "„Abschrift ausgehändigt“ nur bei der hochgeladenen Bestätigung");
  await p.click('[data-abschrift="ab1"]');
  await p.selectOption("#dz-aktion [name=art]", "email");
  await p.click("#dz-aktion button[type=submit]");
  await p.waitForSelector("#dokument-gruppen >> text=Abschrift ausgehändigt am");
  pruefe(aus[0]?.p_dokument_id === "ab1" && aus[0]?.p_art === "email", `Abschrift vermerkt (${JSON.stringify(aus[0])})`);
  await p.click("#hochladen-oeffnen");
  const kat = await p.$$eval("#hochladen-form [name=kategorie] option", (o) => o.map((x) => x.value));
  pruefe(kat.includes("storno"), "Kategorie Storno zum Hochladen");
  pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
  await p.close();
}

const TEILE = [teilMelden, teilBestaetigen, teilUebermittlung, teilListe, teilEinstellungen, teilDokumente];

(async () => {
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const teil of TEILE) await teil(browser);
  } catch (e) {
    pruefe(false, `Abbruch: ${e.message.split("\n").slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
    server.close();
  }
  ende("Austritt-Tests bestanden");
})();
