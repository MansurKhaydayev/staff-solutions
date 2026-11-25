// Erzeugt Bilder der wichtigsten Seiten (Demo-Daten) in mehreren Größen, hell und dunkel.
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/demo_design.js app /pfad/zu/bildern [schritt]
const { chromium, starteServer, neueSeite, anmelden, plus } = require("./mock.js");
const { daten, kopfFuer, rpcFuer } = require("./akte.test.js");
const fs = require("fs");

const [APP = "app", OUT = "/tmp/ui-bilder", NUR = ""] = process.argv.slice(2);
const GROESSEN = { buero: [1280, 860], "ipad-quer": [1180, 820], "ipad-hoch": [820, 1100], handy: [390, 844] };
const SEITEN = [["liste", "#mitarbeiter"], ["akte", "#akte/d1/uebersicht"], ["formular", "#erfassen"], ["einstellungen", "#einstellungen"], ["offen", "#offen"], ["dokumente", "#akte/d1/dokumente"], ["verlauf", "#akte/d1/verlauf"]];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const farbe of ["light", "dark"]) {
      const d = daten();
      const mehr = [["Gruber", "Daniel", "s2", "f1", "vollzeit", 40, -300, 40], ["Huber", "Sophie", "s1", "f2", "teilzeit", 25, -900, null],
        ["Mayer", "Lukas", "s3", "f2", "geringfuegig", 10, -5, null], ["Wagner", "Elif", "s4", "f1", "vollzeit", 38.5, -120, 200]];
      mehr.forEach(([nach, vor, st, fu, art, std, ein, bef], i) => {
        d.mitarbeiter.push({ id: `m${i + 2}`, vorname: vor, nachname: nach });
        d.dienstverhaeltnis.push({ id: `d${i + 2}`, mitarbeiter_id: `m${i + 2}`, heimstandort_id: st, funktion_id: fu, beschaeftigungsart: art,
          wochenstunden: std, eintritt: plus(ein), befristet_bis: bef === null ? null : plus(bef), austritt: null, created_at: `${plus(ein - 1)}T10:00:00Z` });
      });
      const p = await neueSeite(browser, d, { rpc: rpcFuer(d) });
      await p.emulateMedia({ colorScheme: farbe });
      if (!NUR || NUR.split(",").includes("anmeldung")) {
        await p.goto(require("./mock.js").ADRESSE);
        await p.waitForTimeout(400);
        for (const [g, [w, h]] of Object.entries(GROESSEN)) {
          await p.setViewportSize({ width: w, height: h });
          await p.screenshot({ path: `${OUT}/anmeldung-${g}-${farbe === "light" ? "hell" : "dunkel"}.png` });
        }
      }
      await anmelden(p, `${process.env.ROLLE || "hr"}@demo.invalid`);
      for (const [name, adresse] of SEITEN) {
        if (NUR && !NUR.split(",").includes(name)) continue;
        await p.evaluate((a) => { location.hash = a; }, adresse);
        await p.waitForTimeout(700);
        for (const [g, [w, h]] of Object.entries(GROESSEN)) {
          await p.setViewportSize({ width: w, height: h });
          await p.waitForTimeout(150);
          await p.screenshot({ path: `${OUT}/${name}-${g}-${farbe === "light" ? "hell" : "dunkel"}.png`, fullPage: true });
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log("Bilder in", OUT);
})();
