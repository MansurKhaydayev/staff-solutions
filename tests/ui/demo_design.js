// Erzeugt Bilder der wichtigsten Seiten (Demo-Daten) in mehreren Größen, hell und dunkel.
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/demo_design.js app /pfad/zu/bildern [schritt]
const { chromium, starteServer, neueSeite, anmelden } = require("./mock.js");
const { daten, kopfFuer, rpcFuer } = require("./akte.test.js");
const fs = require("fs");

const [APP = "app", OUT = "/tmp/ui-bilder", NUR = ""] = process.argv.slice(2);
const GROESSEN = { buero: [1280, 860], "ipad-quer": [1180, 820], "ipad-hoch": [820, 1100], handy: [390, 844] };
const SEITEN = [["liste", "#mitarbeiter"], ["akte", "#akte/d1/uebersicht"], ["formular", "#erfassen"], ["einstellungen", "#einstellungen"]];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const farbe of ["light", "dark"]) {
      const d = daten();
      const p = await neueSeite(browser, d, { rpc: rpcFuer(d) });
      await p.emulateMedia({ colorScheme: farbe });
      await anmelden(p, "hr@demo.invalid");
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
