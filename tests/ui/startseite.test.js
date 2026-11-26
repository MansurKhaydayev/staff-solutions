// Browser-Test der Startseite mit simulierten Supabase-Antworten (nur erfundene Demo-Daten).
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/startseite.test.js app /tmp/ui
const path = require("path");
const { chromium, demoDaten, starteServer, neueSeite, anmelden, pruefer, plus, ADRESSE } = require("./mock.js");
const { belegschaft, verzeichnisFuer } = require("./demo_startseite.js");

const [APP = "app", OUT = "/tmp/ui"] = process.argv.slice(2);
const { pruefe, ende } = pruefer();

function daten() {
  const d = demoDaten();
  const b = belegschaft();
  d.belegschaft = b.zeilen;
  d.entgelt = b.entgelt;
  d.rollen_recht.find((r) => r.rolle === "hr").darf_arbeitgeber_unterschreiben = true;
  d.rollen_recht.forEach((r) => { r.bezeichnung = r.rolle; });
  for (const r of ["admin", "geschaeftsfuehrung"]) {
    Object.assign(d.rollen_recht.find((x) => x.rolle === r), { darf_analyse_export: true, vergibt_analyse_export: true });
  }
  return d;
}

function rpcFuer(d, extra = {}) {
  return {
    analyse_recht_setzen: (b, seite) => { (seite.gesetzt ||= []).push(b); return null; },
    mitarbeiter_verzeichnis: (_, seite) => verzeichnisFuer(d.belegschaft, d.rollen_recht.find((r) => r.rolle === seite.rolle)),
    offene_punkte: () => [{ art: "a" }, { art: "b" }, { art: "c" }],
    arbeitgeber_offen: () => [{ dokument_id: "x" }],
    ...extra,
  };
}

const kachel = (p, titel) => p.$$eval(".kachel", (ks, t) => {
  const k = ks.find((x) => x.querySelector(".kachel-titel")?.textContent.trim() === t);
  return k ? k.querySelector(".kachel-wert").textContent.trim() : null;
}, titel);

(async () => {
  const k = await import(path.resolve(__dirname, "../../app/kennzahlen.js"));
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------ Personalbüro: alles sichtbar
    const d = daten();
    const p = await neueSeite(browser, d, { rpc: rpcFuer(d) });
    await anmelden(p, "hr@demo.invalid");
    await p.waitForSelector("#t-monat");
    pruefe(!(await p.$eval("#seite-start", (e) => e.hidden)), "nach der Anmeldung kommt die Startseite");
    pruefe(await p.$eval('.navigation a[data-ziel="start"]', (a) => a.getAttribute("aria-current") === "page"),
      "„Startseite“ ist in der Navigation markiert");

    const heute = plus(0);
    const [jahr, monat] = heute.split("-").map(Number);
    const m = k.monatsZahlen(d.belegschaft, jahr, monat, heute);
    const zw = k.zwoelfMonate(d.belegschaft, jahr, monat, heute);
    const fmt = (n) => `${n.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
    pruefe(await kachel(p, "Eintritte") === String(m.eintritte), `Eintritte im Monat = ${m.eintritte}`);
    pruefe(await kachel(p, "Austritte") === String(m.austritte), `Austritte im Monat = ${m.austritte}`);
    pruefe(await kachel(p, "Im Dienst heute") === String(m.standEnde), `im Dienst heute = ${m.standEnde}`);
    pruefe(await kachel(p, "Fluktuation 12 Monate") === fmt(zw.fluktuation), `Fluktuation 12 Monate = ${fmt(zw.fluktuation)}`);
    pruefe(zw.austritte > 0, "Demo-Daten enthalten Austritte");
    pruefe(!(await p.$(".start-hinweis")), "kein Hinweis auf fehlende Austritte, wenn es Austritte gibt");
    pruefe((await p.$$eval(".start-tabelle tbody tr", (r) => r.length)) === 12, "Jahrestabelle hat 12 Monate");
    pruefe(await p.$eval(".start-tabelle tr.gewaehlt th", (t) => t.textContent.includes("bis heute")),
      "laufender Monat ist in der Tabelle markiert");
    pruefe(Boolean(await kachel(p, "Brutto im Monat")), "Personalbüro sieht Brutto im Monat");
    pruefe(Boolean(await kachel(p, "Vollzeitäquivalente")), "Personalbüro sieht Vollzeitäquivalente");
    pruefe(await p.$$eval(".achtung h3", (h) => h.some((x) => x.textContent.includes("Befristung endet"))),
      "Personalbüro sieht ablaufende Befristungen");
    pruefe(await p.$eval(".achtung-raster", (e) => e.textContent.includes("Noch nicht angemeldet")), "Liste „Noch nicht angemeldet“");
    pruefe(await p.$eval('a.zu-tun[href="#offen"] .kachel-wert', (e) => e.textContent) === "3", "Offene Punkte: 3 mit Link");
    pruefe(Boolean(await p.$('a.zu-tun[href="#unterschreiben"]')), "Zu unterschreiben mit Link");
    pruefe(await p.$$eval("svg[role=img]", (s) => s.length) === 2, "zwei Diagramme mit Beschreibung");
    await p.screenshot({ path: `${OUT}/startseite-hr.png`, fullPage: true });

    // Monat wechseln
    const vor = k.monatPlus(jahr, monat, -1);
    if (vor.jahr === jahr) {
      await p.selectOption('#start-steuerung select[name="monat"]', String(vor.monat));
      await p.waitForFunction((t) => document.querySelector("#t-monat").textContent.includes(t),
        ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November"][vor.monat - 1]);
      const vm = k.monatsZahlen(d.belegschaft, vor.jahr, vor.monat, heute);
      pruefe(await kachel(p, "Stand am Monatsende") === String(vm.standEnde), "Vormonat zeigt Stand am Monatsende");
      pruefe(await kachel(p, "Eintritte") === String(vm.eintritte), "Vormonat zeigt seine Eintritte");
    }

    // Arbeitsort filtern
    await p.selectOption('#start-steuerung select[name="arbeitsort"]', "s3");
    await p.waitForFunction(() => document.querySelector("#start-untertitel").textContent.includes("Wien Mitte"));
    const nurS3 = d.belegschaft.filter((z) => z.standort_id === "s3" && k.imDienst(z, heute)).length;
    pruefe(await kachel(p, "Im Dienst") === String(nurS3), `Filter Arbeitsort: ${nurS3} im Dienst in Wien Mitte`);

    // Ohne Recht „Analyse herunterladen“: kein Download-Knopf, keine Rechte-Verwaltung
    pruefe(await p.$eval("#start-pdf", (e) => e.hidden), "Personalbüro ohne Recht: kein Download-Knopf");
    pruefe(!(await p.$("[data-analyse-recht]")), "Personalbüro: keine Verwaltung des Download-Rechts");

    // Ruhiger Einstieg: vier Zahlen oben, der Rest zugeklappt; offen bleibt offen beim Monatswechsel
    pruefe(await p.$$eval("section[aria-labelledby='t-monat'] .kachel", (x) => x.length) === 4, "oben genau vier Zahlen");
    pruefe(await p.$$eval("section[aria-labelledby='t-monat'] svg", (x) => x.length) === 1, "oben genau ein Diagramm");
    pruefe(!(await p.$eval("#start-details", (e) => e.open)), "Details sind anfangs zugeklappt");
    pruefe(!(await p.isVisible(".start-tabelle")), "Monatstabelle erst nach dem Aufklappen sichtbar");
    const vorAchtung = await p.$eval("#t-achtung", (h) => h.compareDocumentPosition(document.querySelector("#t-monat")) & 4);
    pruefe(Boolean(vorAchtung), "„Was ansteht“ steht vor den Zahlen");
    await p.click("#start-details > summary");
    pruefe(await p.isVisible(".start-tabelle"), "nach dem Aufklappen: Monatstabelle sichtbar");
    const monate = await p.$$eval('#start-steuerung select[name="monat"] option', (o) => o.map((x) => x.value));
    await p.selectOption('#start-steuerung select[name="monat"]', monate[0]);
    pruefe(await p.$eval("#start-details", (e) => e.open), "Details bleiben beim Monatswechsel offen");
    pruefe(await p.$$eval(".kachel-titel", (t) => t.filter((x) => x.textContent.trim() === "Fluktuation 12 Monate").length) === 1,
      "keine Zahl doppelt (Fluktuation 12 Monate nur einmal)");

    // Dienstzettel-Erfassung bleibt erreichbar
    await p.goto(`${ADRESSE}#erfassen`);
    await p.waitForSelector("#seite-erfassen:not([hidden])");
    pruefe(await p.$eval("#seite-start", (e) => e.hidden), "„Neuer Mitarbeiter“ ist weiterhin eine eigene Seite");
    pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
    await p.close();

    // ------------------------------------------------ Admin: Download und Recht vergeben
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    const adm = await neueSeite(browser, d, {
      rpc: rpcFuer(d),
      funktionen: { analyse: (b, seite) => { (seite.pdfAnfragen ||= []).push(b);
        return seite.pdfFehler ? { status: 403, body: { meldung: "Mit deinem Zugang kannst du die Analyse nicht herunterladen." } }
          : { roh: pdf, kopf: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="Personalanalyse-2026-11.pdf"', "Access-Control-Expose-Headers": "content-disposition" } }; } },
    });
    await anmelden(adm, "admin@demo.invalid");
    await adm.waitForSelector("#t-monat");
    pruefe(!(await adm.$eval("#start-pdf", (e) => e.hidden)), "Admin mit Recht: Knopf „PDF herunterladen“");
    await adm.selectOption('#start-steuerung select[name="arbeitsort"]', "s3");
    const [download] = await Promise.all([adm.waitForEvent("download"), adm.click("#start-pdf")]);
    pruefe(download.suggestedFilename() === "Personalanalyse-2026-11.pdf", "PDF wird mit Dateinamen heruntergeladen");
    pruefe(adm.pdfAnfragen[0]?.monat === monat && adm.pdfAnfragen[0]?.jahr === jahr && adm.pdfAnfragen[0]?.standort === "s3",
      "gewählter Monat und Arbeitsort gehen an den Server");
    adm.pdfFehler = true;
    await adm.click("#start-pdf");
    await adm.waitForSelector("#start-pdf-meldung:not([hidden])");
    pruefe((await adm.textContent("#start-pdf-meldung")).includes("nicht herunterladen"), "Ablehnung vom Server wird angezeigt");
    pruefe(!(await adm.$("[data-analyse-recht]")), "Startseite zeigt die Vergabe des Rechts nicht mehr");
    await adm.screenshot({ path: `${OUT}/startseite-admin.png`, fullPage: true });

    // Vergabe in den Einstellungen
    await adm.goto(`${ADRESSE}#einstellungen`);
    await adm.waitForSelector("#einstellung-analyse:not([hidden]) [data-analyse-recht]");
    pruefe(await adm.$$eval("[data-analyse-recht]", (x) => x.length) === 7, "Einstellungen: alle Rollen außer „nur eigene Daten“");
    pruefe(await adm.$eval('[data-analyse-recht="geschaeftsfuehrung"]', (x) => x.checked), "GF ist angehakt");
    pruefe(!(await adm.$eval("#t-rechte", (e) => e.closest("section").hidden)), "Admin sieht auch die übrigen Einstellungen");
    await adm.check('[data-analyse-recht="hr"]');
    await adm.waitForFunction(() => !document.querySelector('[data-analyse-recht="hr"]').disabled);
    pruefe(adm.gesetzt?.[0]?.p_rolle === "hr" && adm.gesetzt[0].p_darf === true, "Admin gibt dem Personalbüro das Recht");
    pruefe((await adm.textContent("#einstellungen-status")).includes("Gespeichert"), "Bestätigung nach dem Speichern");
    await adm.uncheck('[data-analyse-recht="admin"]');
    await adm.waitForFunction(() => !document.querySelector('[data-analyse-recht="admin"]').disabled);
    await adm.goto(`${ADRESSE}#start`);
    await adm.waitForSelector("#t-monat");
    pruefe(await adm.$eval("#start-pdf", (e) => e.hidden), "eigenes Recht entzogen: kein Download-Knopf mehr");
    pruefe(adm.jsFehler.length === 0, `keine JS-Fehler (${adm.jsFehler.join("; ")})`);
    await adm.close();
    d.rollen_recht.find((r) => r.rolle === "admin").darf_analyse_export = true;

    // Geschäftsführung ohne „verwalten“: Einstellungen zeigen nur die Analyse-Vergabe; Ablehnung setzt den Haken zurück
    const gf = await neueSeite(browser, d, { rpc: rpcFuer(d, {
      analyse_recht_setzen: () => ({ status: 400, body: { message: "Das Recht „Analyse herunterladen“ können nur Rollen ändern, die es vergeben dürfen." } }) }) });
    await anmelden(gf, "gf@demo.invalid");
    await gf.waitForSelector("#t-monat");
    pruefe(!(await gf.$eval('.navigation a[data-ziel="einstellungen"]', (a) => a.hidden)), "GF sieht „Einstellungen“");
    await gf.goto(`${ADRESSE}#einstellungen`);
    await gf.waitForSelector("#einstellung-analyse:not([hidden]) [data-analyse-recht]");
    pruefe(await gf.$eval("#t-rechte", (e) => e.closest("section").hidden), "GF ohne „verwalten“ sieht nur die Analyse-Vergabe");
    await gf.click('[data-analyse-recht="buchhaltung"]');
    await gf.waitForSelector("#einstellungen-status.fehler");
    pruefe(!(await gf.$eval('[data-analyse-recht="buchhaltung"]', (x) => x.checked)), "abgelehnt: Haken springt zurück");
    pruefe(gf.jsFehler.length === 0, `keine JS-Fehler (${gf.jsFehler.join("; ")})`);
    await gf.close();

    // ------------------------------------------------ Studioleitung: eigene Studios, kein Geld, keine Personendaten
    const sl = await neueSeite(browser, d, { rpc: rpcFuer(d) });
    await anmelden(sl, "sl@demo.invalid");
    await sl.waitForSelector("#t-monat");
    const nurS1 = d.belegschaft.filter((z) => z.standort_id === "s1" && k.imDienst(z, heute)).length;
    pruefe(await kachel(sl, "Im Dienst") === String(nurS1), `Studioleitung sieht nur ihr Studio (${nurS1})`);
    pruefe(!(await kachel(sl, "Brutto im Monat")), "Studioleitung sieht kein Brutto");
    pruefe(!sl.anfragen.some((a) => a.pfad === "/rest/v1/entgelt"), "für die Studioleitung wird kein Entgelt geladen");
    pruefe(!(await kachel(sl, "Vollzeitäquivalente")), "ohne Personendaten keine Vollzeitäquivalente");
    pruefe(!(await sl.$$eval(".achtung h3", (h) => h.some((x) => x.textContent.includes("Befristung")))),
      "ohne Personendaten keine Befristungen");
    pruefe(await sl.$eval('#start-steuerung select[name="arbeitsort"]', (s) => s.closest("label").hidden),
      "bei nur einem Arbeitsort keine Ortsauswahl");
    pruefe(!(await sl.$('a.zu-tun[href="#unterschreiben"]')), "ohne Arbeitgeber-Recht kein „Zu unterschreiben“");
    pruefe(await sl.$eval("#start-pdf", (e) => e.hidden), "Studioleitung: kein Download-Knopf");
    pruefe(!(await sl.$("[data-analyse-recht]")), "Studioleitung: keine Rechte-Verwaltung");
    pruefe(sl.jsFehler.length === 0, `keine JS-Fehler (${sl.jsFehler.join("; ")})`);
    await sl.screenshot({ path: `${OUT}/startseite-studioleitung.png`, fullPage: true });
    await sl.close();

    // ------------------------------------------------ Noch keine Austritte: Hinweis
    const leer = daten();
    leer.belegschaft = leer.belegschaft.map((z) => ({ ...z, austritt: null }));
    const v = await neueSeite(browser, leer, { rpc: rpcFuer(leer) });
    await anmelden(v, "verw@demo.invalid");
    await v.waitForSelector("#t-monat");
    pruefe(await v.$eval(".start-hinweis", (e) => e.textContent.includes("Austritte kann die App noch nicht")),
      "ohne Austritte erklärt ein Hinweis, warum die Fluktuation leer ist");
    pruefe(await kachel(v, "Fluktuation 12 Monate") === "0,0 %", "Fluktuation ohne Austritte 0,0 %");

    // Handybreite: nichts ragt seitlich hinaus
    await v.setViewportSize({ width: 390, height: 844 });
    pruefe(await v.evaluate(() => document.documentElement.scrollWidth <= 390), "am Handy kein seitliches Scrollen");
    await v.screenshot({ path: `${OUT}/startseite-handy.png`, fullPage: true });
    pruefe(v.jsFehler.length === 0, `keine JS-Fehler (${v.jsFehler.join("; ")})`);
    await v.close();

    // ------------------------------------------------ Fehler beim Laden
    const f = await neueSeite(browser, d, { rpc: rpcFuer(d, { mitarbeiter_verzeichnis: () => ({ status: 500, body: { message: "kaputt" } }) }) });
    await anmelden(f, "hr@demo.invalid");
    await f.waitForSelector("#start-inhalt .fehler");
    pruefe(await f.$eval("#start-inhalt .fehler", (e) => e.textContent.includes("konnten nicht geladen werden")),
      "Ladefehler wird verständlich angezeigt");
    await f.close();
  } catch (e) {
    pruefe(false, `Abbruch: ${e.message.split("\n").slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
    server.close();
  }
  ende("UI-Tests Startseite bestanden");
})();
