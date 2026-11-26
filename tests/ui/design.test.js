// Prüft das Glas-Design: Kontrast von Text (WCAG AA) und Mindestgröße von Bedienelementen (44 px) auf den Hauptseiten,
// hell und dunkel, in drei Größen. Nur erfundene Demo-Daten.
// Aufruf: NODE_PATH=$(npm root -g) node tests/ui/design.test.js app /tmp/ui
const { chromium, starteServer, neueSeite, anmelden, pruefer, plus, ADRESSE } = require("./mock.js");
const { daten, rpcFuer } = require("./akte.test.js");
const { startDaten, startRpc } = require("./demo_startseite.js");
const { demoDaten } = require("./mock.js");

const [APP = "app"] = process.argv.slice(2);
const { pruefe, ende } = pruefer();
const GROESSEN = { buero: [1280, 860], "ipad-hoch": [820, 1100], handy: [390, 844] };
// Hintergrund der Seite (Verlauf): ungünstigste Stellen
const GRUND = { light: ["#bdd8e9", "#8cc6ea", "#6ea2b3"], dark: ["#001d39", "#0a2f57", "#0a4174"] };
const SEITEN = [["liste", "#mitarbeiter", "hr"], ["akte", "#akte/d1/uebersicht", "hr"], ["dokumente", "#akte/d1/dokumente", "hr"],
  ["formular", "#erfassen", "hr"], ["einstellungen", "#einstellungen", "admin"], ["offen", "#offen", "hr"]];

// läuft im Browser: liefert Verstöße gegen Kontrast und Größe
function messen({ grund }) {
  const hexZuRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lesen = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const t = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [t[0], t[1], t[2], t.length > 3 ? t[3] : 1];
  };
  const ueber = (v, h) => [0, 1, 2].map((i) => v[i] * v[3] + h[i] * (1 - v[3]));
  const hell = (c) => { const f = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const kontrast = (a, b) => { const x = hell(a), y = hell(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // mögliche Hintergründe eines Elements: von innen nach außen übereinander legen
  const hintergruende = (el) => {
    let basen = grund.map(hexZuRgb);
    const kette = [];
    for (let e = el; e; e = e.parentElement) kette.push(e);
    for (const e of kette.reverse()) {
      const cs = getComputedStyle(e);
      const bild = cs.backgroundImage;
      if (bild && bild !== "none") {
        // mehrere Ebenen: durch Kommas auf oberster Ebene getrennt, die letzte liegt unten
        const ebenen = []; let tiefe = 0, start = 0;
        for (let i = 0; i < bild.length; i++) {
          if (bild[i] === "(") tiefe++;
          else if (bild[i] === ")") tiefe--;
          else if (bild[i] === "," && tiefe === 0) { ebenen.push(bild.slice(start, i)); start = i + 1; }
        }
        ebenen.push(bild.slice(start));
        for (const ebene of ebenen.reverse()) {
          const stufen = [...ebene.matchAll(/rgba?\([^)]+\)/g)].map((m) => lesen(m[0]));
          if (stufen.length) basen = stufen.flatMap((st) => basen.map((b) => ueber(st, b)));
        }
      }
      const f = lesen(cs.backgroundColor);
      if (f && f[3] > 0) basen = basen.map((b) => ueber(f, b));
    }
    return basen;
  };
  const verstoesse = [];
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.opacity !== "0"; };
  for (const el of document.querySelectorAll("body *")) {
    if (!sichtbar(el) || el.closest("[aria-hidden='true'], [hidden], svg, script, style, option, progress")) continue;
    const hatText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const istFeld = el.matches("input, select, textarea");
    if (!hatText && !istFeld) continue;
    if (el.disabled) continue;
    const cs = getComputedStyle(el);
    const vorn = lesen(cs.color);
    if (!vorn) continue;
    const basen = hintergruende(el);
    let schlecht = 99;
    for (const b of basen) schlecht = Math.min(schlecht, kontrast(ueber(vorn, b), b));
    const px = parseFloat(cs.fontSize);
    const gross = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const ziel = gross ? 3 : 4.5;
    if (schlecht < ziel) verstoesse.push(`Kontrast ${schlecht.toFixed(2)} < ${ziel}: ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} „${(el.textContent || el.value || "").trim().slice(0, 30)}“`);
  }
  for (const el of document.querySelectorAll("button, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), .navigation a, .reiter a, a.knopf")) {
    if (!sichtbar(el) || el.closest("[hidden]")) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) verstoesse.push(`Höhe ${Math.round(r.height)} px < 44: ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} „${(el.textContent || el.name || "").trim().slice(0, 25)}“`);
  }
  return verstoesse;
}

(async () => {
  const server = await starteServer(APP);
  const browser = await chromium.launch();
  try {
    for (const farbe of ["light", "dark"]) {
      for (const rolle of ["hr", "admin"]) {
        const d = daten();
        const p = await neueSeite(browser, d, { rpc: rpcFuer(d) });
        await p.emulateMedia({ colorScheme: farbe });
        if (rolle === "hr") {
          await p.goto(ADRESSE);
          await p.waitForTimeout(300);
          const v = await p.evaluate(messen, { grund: GRUND[farbe] });
          pruefe(v.length === 0, `Anmeldung ${farbe}: ${v.slice(0, 4).join(" | ")}`);
        }
        await anmelden(p, `${rolle}@demo.invalid`);
        for (const [name, adresse, wer] of SEITEN) {
          if (wer !== rolle) continue;
          await p.evaluate((a) => { location.hash = a; }, adresse);
          await p.waitForTimeout(600);
          for (const [g, [w, h]] of Object.entries(GROESSEN)) {
            await p.setViewportSize({ width: w, height: h });
            await p.waitForTimeout(100);
            const v = await p.evaluate(messen, { grund: GRUND[farbe] });
            const breit = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
            pruefe(breit <= 1, `${name} ${g} ${farbe}: Seite läuft nicht seitlich über (${breit} px)`);
            pruefe(v.length === 0, `${name} ${g} ${farbe}${v.length ? `: ${v.length} Verstöße, z. B. ${[...new Set(v)].slice(0, 5).join(" | ")}` : ""}`);
          }
        }
        pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
      }
      // Startseite mit Kennzahlen (eigene Testdaten)
      const sd = startDaten(demoDaten);
      const sp = await neueSeite(browser, sd, { rpc: startRpc(sd) });
      await sp.emulateMedia({ colorScheme: farbe });
      await anmelden(sp, "admin@demo.invalid");
      await sp.evaluate(() => { location.hash = "#start"; });
      await sp.waitForTimeout(900);
      for (const [g, [w, h]] of Object.entries(GROESSEN)) {
        await sp.setViewportSize({ width: w, height: h });
        await sp.waitForTimeout(150);
        const v = await sp.evaluate(messen, { grund: GRUND[farbe] });
        pruefe(v.length === 0, `start ${g} ${farbe}${v.length ? `: ${v.length} Verstöße, z. B. ${[...new Set(v)].slice(0, 5).join(" | ")}` : ""}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  ende("Design-Tests bestanden");
})();
