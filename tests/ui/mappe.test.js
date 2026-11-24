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

(async () => {
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const teil of [teilAblauf, teilFehler]) await teil(browser);
  } catch (e) {
    pruefe(false, `Abbruch: ${e.message.split("\n").slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
    server.close();
  }
  ende("Mappe-Tests bestanden");
})();
