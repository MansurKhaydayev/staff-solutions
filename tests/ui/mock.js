// Browser-Tests mit simulierten Supabase-Antworten (nur erfundene Demo-Daten).
// Aufruf eines Tests:  NODE_PATH=$(npm root -g) node tests/ui/<test>.js app /tmp/ui
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SUPABASE = "https://dzvalpnptlbrogfkunbr.supabase.co";
const PORT = 8765;
const ADRESSE = `http://localhost:${PORT}/`;

const heute = new Date();
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plus = (tage) => { const d = new Date(heute); d.setDate(d.getDate() + tage); return iso(d); };

// Anmelde-Adresse -> Rolle
const ROLLEN = {
  "admin@demo.invalid": "admin", "hr@demo.invalid": "hr", "verw@demo.invalid": "verwaltung",
  "buch@demo.invalid": "buchhaltung", "rl@demo.invalid": "regionalleitung", "sl@demo.invalid": "studioleitung",
  "gf@demo.invalid": "geschaeftsfuehrung",
};

function demoDaten() {
  const d = {
    organisation: [{ id: "o", name: "Demo", probezeit_monate: 1, befristung_monate: 3, vollzeit_stunden: 40,
      geringfuegig_grenze: 551.1, max_stunden_tag: 10 }],
    standort: [
      { id: "s2", name: "Bruck an der Mur", art: "studio", vertragsbezeichnung: "DemoFit Bruck an der Mur", gesellschaft_id: "g2", tarifzone_id: "zs" },
      { id: "s4", name: "Büro Graz", art: "buero", vertragsbezeichnung: "Graz", gesellschaft_id: "g1", tarifzone_id: "zs" },
      { id: "s1", name: "Leoben", art: "studio", vertragsbezeichnung: "DemoFit Leoben", gesellschaft_id: "g2", tarifzone_id: "zs" },
      { id: "s3", name: "Wien Mitte", art: "studio", vertragsbezeichnung: "DemoFit Wien Mitte", gesellschaft_id: "g3", tarifzone_id: "zw" },
    ],
    gesellschaft: [
      { id: "g1", name: "DemoFit Holding GmbH" }, { id: "g2", name: "DemoFit Steiermark GmbH" }, { id: "g3", name: "DemoFit Wien GmbH" },
    ],
    tarifzone: [{ id: "zs", name: "Standard" }, { id: "zw", name: "Wien" }],
    funktion: [
      { id: "f1", name: "Reinigungskraft", bereich: "studio", anlegen_durch: ["studioleitung", "regionalleitung"], leiterzulage_moeglich: false },
      { id: "f2", name: "Servicekraft", bereich: "studio", anlegen_durch: ["studioleitung", "regionalleitung"], leiterzulage_moeglich: false },
      { id: "f3", name: "Studioleitung", bereich: "studio", anlegen_durch: ["regionalleitung"], leiterzulage_moeglich: true },
      { id: "f4", name: "Verwaltung", bereich: "buero", anlegen_durch: [], leiterzulage_moeglich: false },
    ],
    brutto_tabelle: [],
    zustaendigkeit: [{ standort_id: "s1" }],
  };
  for (let n = 500; n <= 2500; n += 50) {
    d.brutto_tabelle.push({ tarifzone_id: "zs", netto: n, brutto: +(n * 1.3).toFixed(2), gueltig_ab: "2026-01-01" });
    d.brutto_tabelle.push({ tarifzone_id: "zw", netto: n, brutto: +(n * 1.31).toFixed(2), gueltig_ab: "2026-01-01" });
  }
  const R = (rolle, k, p, e, l, dok, w, a, v) => ({ organisation_id: "o", rolle, sieht_kontakt: !!k, sieht_personendaten: !!p,
    sieht_entgelt: !!e, sieht_lohnverrechnung: !!l, sieht_dokumente: !!dok, reichweite: w, darf_anlegen: !!a, darf_verwalten: !!v });
  d.rollen_recht = [
    R("admin", 1, 1, 1, 1, 1, "alle", 1, 1), R("geschaeftsfuehrung", 1, 1, 1, 1, 1, "alle", 1, 0),
    R("hr", 1, 1, 1, 1, 1, "alle", 1, 0), R("verwaltung", 1, 0, 0, 0, 0, "alle", 0, 0),
    R("buchhaltung", 1, 1, 1, 1, 0, "alle", 0, 0), R("regionalleitung", 1, 1, 1, 0, 1, "zugeordnet", 1, 0),
    R("studioleitung", 1, 0, 0, 0, 1, "zugeordnet", 1, 0), R("mitarbeiter", 0, 0, 0, 0, 0, "eigene", 0, 0),
  ];
  return d;
}

function starteServer(app) {
  const wurzel = path.resolve(app);
  const server = http.createServer((req, res) => {
    const datei = path.join(wurzel, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    if (!datei.startsWith(wurzel) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) { res.writeHead(404); return res.end(); }
    const typ = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(datei)];
    res.writeHead(200, { "Content-Type": `${typ}; charset=utf-8` });
    fs.createReadStream(datei).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

// PostgREST-Filter "spalte=eq.wert" (mehrere möglich) auf Zeilen anwenden
function filtern(zeilen, suche) {
  let z = zeilen;
  for (const [k, v] of suche) {
    if (["select", "order", "limit"].includes(k)) continue;
    if (v.startsWith("eq.")) z = z.filter((r) => String(r[k]) === v.slice(3));
    else if (v === "is.null") z = z.filter((r) => r[k] === null || r[k] === undefined);
    else if (v.startsWith("in.(")) { const w = v.slice(4, -1).split(","); z = z.filter((r) => w.includes(String(r[k]))); }
  }
  return z;
}

// Neue Browser-Seite. optionen.rpc = { name: (body, seite) => antwort | { status, body } }
// optionen.funktionen = { name: (body, seite) => { status?, body } }  (Edge Functions)
async function neueSeite(browser, daten, optionen = {}) {
  const page = await browser.newPage({ viewport: optionen.groesse || { width: 1280, height: 900 }, locale: "de-AT" });
  page.setDefaultTimeout(5000);
  page.jsFehler = [];
  page.anfragen = [];
  page.rolle = "hr";
  page.on("pageerror", (e) => page.jsFehler.push(process.env.STACK ? e.stack : e.message));
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    let body = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    page.anfragen.push({ methode: req.method(), pfad: url.pathname, suche: url.search, body,
      kopf: req.headers() });

    if (url.pathname === "/auth/v1/token") {
      page.rolle = ROLLEN[body.email] || "hr";
      return json({ access_token: "t", user: { id: "u1", email: body.email } });
    }
    if (url.pathname === "/auth/v1/logout") return json({});
    if (url.pathname === "/rest/v1/profil") return json([{ user_id: "u1", organisation_id: "o", rolle: page.rolle }]);
    const recht = daten.rollen_recht.find((r) => r.rolle === page.rolle);
    if (url.pathname === "/rest/v1/rollen_recht" && url.search.includes("rolle=eq.") && req.method() === "GET") {
      return json(daten.rollen_recht.filter((r) => url.search.includes(`rolle=eq.${r.rolle}`)));
    }
    if (url.pathname === "/rest/v1/brutto_tabelle") return json(recht.sieht_entgelt ? daten.brutto_tabelle : []);

    if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      return json({ signedURL: `/object/sign/${url.pathname.slice("/storage/v1/object/sign/".length)}?token=t` });
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (optionen.storage) { const a = optionen.storage(req, page); if (a) return json(a.body, a.status); }
      return json({ Key: url.pathname.slice("/storage/v1/object/".length) });
    }
    if (url.pathname.startsWith("/functions/v1/")) {
      const name = url.pathname.slice("/functions/v1/".length);
      const h = optionen.funktionen && optionen.funktionen[name];
      if (!h) return json({ meldung: `Funktion ${name} nicht simuliert` }, 404);
      const a = await h(body || {}, page);
      if (a.roh) return route.fulfill({ status: 200, body: a.roh, headers: a.kopf || {} });
      return json(a.body, a.status || 200);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const h = optionen.rpc && optionen.rpc[name];
      if (!h) return json({ message: `RPC ${name} nicht simuliert` }, 404);
      const a = await h(body || {}, page);
      if (a && typeof a.status === "number") return json(a.body, a.status);
      return json(a === undefined ? null : a);
    }
    const tabelle = url.pathname.replace("/rest/v1/", "");
    const zeilen = daten[tabelle] || [];
    if (req.method() === "PATCH") {
      const treffer = filtern(zeilen, url.searchParams);
      for (const z of treffer) Object.assign(z, body);
      return json(treffer);
    }
    if (req.method() === "POST") {
      const neu = { id: `neu${zeilen.length + 1}`, ...body };
      (daten[tabelle] ||= []).push(neu);
      return json([neu], 201);
    }
    return json(filtern(zeilen, url.searchParams));
  });
  return page;
}

async function anmelden(page, email) {
  await page.goto(ADRESSE);
  await page.fill('#anmelde-formular input[name="email"]', email);
  await page.fill('#anmelde-formular input[name="passwort"]', "x");
  await page.click("text=Anmelden");
  await page.waitForSelector("#ansicht-programm:not([hidden])");
}

// Kleiner Prüfer: sammelt Fehler, beendet mit Code 1, wenn etwas nicht stimmt
function pruefer() {
  const fehler = [];
  const pruefe = (ok, was) => { if (!ok) fehler.push(was); console.log(`${ok ? "ok  " : "FEHL"} ${was}`); };
  const ende = (text) => {
    if (fehler.length) { console.log(`\n${fehler.length} Prüfung(en) fehlgeschlagen.`); process.exitCode = 1; }
    else console.log(`\n${text}`);
  };
  return { pruefe, ende };
}

module.exports = { chromium, demoDaten, starteServer, neueSeite, anmelden, pruefer, plus, ADRESSE };

// Rauchtest: Anmelden als Personalbüro, Startseite sichtbar, Dienstzettel erreichbar, keine JS-Fehler
if (require.main === module) {
  (async () => {
    const [app = "app"] = process.argv.slice(2);
    const server = await starteServer(app);
    const browser = await chromium.launch();
    const { pruefe, ende } = pruefer();
    try {
      const daten = demoDaten();
      daten.dienstverhaeltnis = []; daten.mitarbeiter = [];
      const p = await neueSeite(browser, daten, { rpc: { mitarbeiter_verzeichnis: () => [], offene_punkte: () => [] } });
      await anmelden(p, "hr@demo.invalid");
      pruefe(!(await p.$eval("#seite-start", (e) => e.hidden)), "Startseite ist nach der Anmeldung sichtbar");
      await p.click('.navigation a[data-ziel="erfassen"]');
      await p.waitForSelector("#seite-erfassen:not([hidden])").catch(() => {});
      pruefe(!(await p.$eval("#seite-erfassen", (e) => e.hidden)), "Dienstzettel-Seite über „Neuer Mitarbeiter“ erreichbar");
      pruefe(p.jsFehler.length === 0, `keine JS-Fehler (${p.jsFehler.join("; ")})`);
    } finally {
      await browser.close();
      server.close();
    }
    ende("Rauchtest bestanden");
  })();
}
