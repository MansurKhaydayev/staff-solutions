// PDF der Personalanalyse (A4 hoch). pdf-lib wird übergeben, damit es in Deno und Node gleich läuft.
// Aufbau wie die Startseite: Monat, Jahresübersicht (Säulen, Linie, Tabelle), Personal heute, was bald ansteht.
import { MONATE } from "./bericht.js";

const A4 = [595.28, 841.89];
const RAND = 40;
const KURZ = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Zeichen, die die Schrift nicht kennt, werden „?“ (wie in der Edge Function „mappe“)
function textFuer(t, bekannt) {
  return [...String(t ?? "").replace(/[\t\r\n]+/g, " ").normalize("NFC")]
    .map((z) => (bekannt.has(z.codePointAt(0)) ? z : "?")).join("");
}

const zahl = (n, stellen = 0) => (n === null || n === undefined ? "–"
  : Number(n).toLocaleString("de-AT", { minimumFractionDigits: stellen, maximumFractionDigits: stellen, useGrouping: true })
    .replace(/ | /g, "."));
const prozent = (n) => (n === null || n === undefined ? "–" : `${zahl(n, 1)} %`);
const datum = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");

// schrift = { fontkit, normal, fett }: gekürzte DejaVu Sans aus mappe/schrift.js (Latein, Griechisch, Kyrillisch)
export async function analysePdf(lib, b, schrift) {
  if (!schrift?.fontkit || !schrift.normal || !schrift.fett) throw new Error("Schrift fehlt");
  const { PDFDocument, rgb } = lib;
  const dok = await PDFDocument.create();
  dok.registerFontkit(schrift.fontkit);
  dok.setTitle(b.titel);
  dok.setCreator("Staff-Solutions");
  const normal = await dok.embedFont(schrift.normal, { subset: true });
  const fett = await dok.embedFont(schrift.fett, { subset: true });
  const bekannt = new Map([normal, fett].map((f) => [f, new Set(f.getCharacterSet())]));
  const text = (t, font = normal) => textFuer(t, bekannt.get(font));
  const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const F = {
    tinte: hex("#001D39"), leise: hex("#44576D"), akzent: hex("#0A4174"), hell: hex("#EEF5FB"), rand: hex("#C9D6E3"),
    ein: hex("#1F5FA8"), aus: hex("#D0661E"), weiss: rgb(1, 1, 1), markierung: hex("#DCECF8"),
  };
  const breite = A4[0] - 2 * RAND;
  let seite, y;

  const neueSeite = () => { seite = dok.addPage(A4); y = A4[1] - RAND; };
  const platz = (h) => { if (y - h < RAND + 24) neueSeite(); };
  const schreib = (t, x, yy, { font = normal, groesse = 9, farbe = F.tinte, rechts = false, mitte = false } = {}) => {
    const s = text(t, font);
    const w = font.widthOfTextAtSize(s, groesse);
    seite.drawText(s, { x: rechts ? x - w : mitte ? x - w / 2 : x, y: yy, size: groesse, font, color: farbe });
  };
  const kuerzen = (t, font, groesse, max) => {
    let s = text(t, font);
    while (s.length > 1 && font.widthOfTextAtSize(s, groesse) > max) s = s.slice(0, -2) + "…";
    return s;
  };
  // Überschrift nie allein am Seitenende: Platz für die Überschrift und den ersten Block
  const ueberschrift = (t, zusatz = "") => {
    platz(110);
    y -= 18;
    schreib(t, RAND, y, { font: fett, groesse: 13 });
    if (zusatz) schreib(zusatz, RAND + fett.widthOfTextAtSize(text(t, fett), 13) + 8, y, { groesse: 9, farbe: F.leise });
    y -= 10;
  };
  const kacheln = (liste, spalten = 3) => {
    const abstand = 8, h = 54, w = (breite - abstand * (spalten - 1)) / spalten;
    for (let i = 0; i < liste.length; i += spalten) {
      platz(h + abstand);
      liste.slice(i, i + spalten).forEach((kd, j) => {
        const x = RAND + j * (w + abstand), unten = y - h;
        const betont = kd.betont;
        seite.drawRectangle({ x, y: unten, width: w, height: h, color: betont ? F.akzent : F.hell,
          borderColor: betont ? F.akzent : F.rand, borderWidth: 0.6 });
        const tf = betont ? F.weiss : F.leise;
        schreib(kuerzen(kd.titel, fett, 8, w - 16), x + 8, y - 13, { font: fett, groesse: 8, farbe: tf });
        schreib(kd.wert, x + 8, y - 33, { font: fett, groesse: 17, farbe: betont ? F.weiss : F.tinte });
        if (kd.zusatz) schreib(kuerzen(kd.zusatz, normal, 7, w - 16), x + 8, y - 46, { groesse: 7, farbe: tf });
      });
      y -= h + abstand;
    }
  };

  // ------------------------------------------------ Kopf
  neueSeite();
  schreib(b.firma, RAND, y, { font: fett, groesse: 9, farbe: F.leise });
  schreib("Vertraulich: Personaldaten", RAND + breite, y, { groesse: 8, farbe: F.leise, rechts: true });
  y -= 22;
  schreib(b.titel, RAND, y, { font: fett, groesse: 20 });
  y -= 15;
  schreib(`${b.ort} · erstellt am ${b.erstellt} · Rolle „${b.rolle}“ · Protokoll-Nr. ${b.protokollNr}`, RAND, y,
    { groesse: 8.5, farbe: F.leise });
  y -= 8;
  seite.drawLine({ start: { x: RAND, y }, end: { x: RAND + breite, y }, thickness: 1.5, color: F.akzent });
  y -= 6;
  if (b.ohneAustritte) {
    y -= 16;
    schreib("Hinweis: Austritte kann die App noch nicht erfassen. Austritte und Fluktuation bleiben bis zum Austritt-Modul bei 0.",
      RAND, y, { groesse: 8, farbe: F.aus });
  }

  // ------------------------------------------------ Monat
  const m = b.monat;
  const geplant = (n) => (n ? `dazu ${n} geplant` : "");
  ueberschrift(m.name, m.laufend ? "bis heute" : "");
  kacheln([
    { titel: m.laufend ? "Im Dienst heute" : "Stand am Monatsende", wert: zahl(m.standEnde), zusatz: `am Monatsanfang ${zahl(m.standAnfang)}` },
    { titel: "Eintritte", wert: zahl(m.eintritte), zusatz: [geplant(m.eintritteGeplant), `Vormonat ${zahl(m.vormonat.eintritte)}`].filter(Boolean).join(" · ") },
    { titel: "Austritte", wert: zahl(m.austritte), zusatz: [geplant(m.austritteGeplant), `Vormonat ${zahl(m.vormonat.austritte)}`].filter(Boolean).join(" · ") },
    { titel: "Fluktuation im Monat", wert: prozent(m.fluktuation), zusatz: `Vormonat ${prozent(m.vormonat.fluktuation)}` },
    { titel: "Fluktuation 12 Monate", wert: prozent(m.zwoelf.fluktuation), betont: true,
      zusatz: `${zahl(m.zwoelf.austritte)} Austritte bei Ø ${zahl(m.zwoelf.durchschnitt, 1)} Personen` },
    { titel: "Frühfluktuation 12 Monate", wert: prozent(m.frueh.anteil),
      zusatz: m.frueh.austritte ? `${m.frueh.inProbezeit} von ${m.frueh.austritte} in der Probezeit` : "noch keine Austritte" },
  ]);

  // ------------------------------------------------ Jahr
  const j = b.jahr;
  ueberschrift(`Jahresübersicht ${j.jahr}`);
  kacheln([
    { titel: "Eintritte im Jahr", wert: zahl(j.eintritte) },
    { titel: "Austritte im Jahr", wert: zahl(j.austritte) },
    { titel: "Ø Personalstand", wert: zahl(j.durchschnitt, 1), zusatz: "Durchschnitt der Monatsend-Stände" },
    { titel: "Fluktuation im Jahr", wert: prozent(j.fluktuation), betont: true },
    { titel: "Frühfluktuation im Jahr", wert: prozent(j.frueh.anteil),
      zusatz: j.frueh.austritte ? `${j.frueh.inProbezeit} von ${j.frueh.austritte} in der Probezeit` : "noch keine Austritte" },
  ]);

  // Säulen und Linie nebeneinander
  const dh = 130, dw = (breite - 8) / 2;
  platz(dh + 10);
  const diagramm = (x0, titel, zeichnen) => {
    seite.drawRectangle({ x: x0, y: y - dh, width: dw, height: dh, borderColor: F.rand, borderWidth: 0.6 });
    schreib(titel, x0 + 8, y - 14, { font: fett, groesse: 9 });
    zeichnen(x0 + 8, y - dh + 16, dw - 16, dh - 44);   // Fläche: x, unten, Breite, Höhe
  };
  const achse = (x0, unten, w) => j.monate.forEach((mm, i) =>
    schreib(KURZ[i], x0 + (w / 12) * (i + 0.5), unten - 10, { groesse: 6.5, farbe: F.leise, mitte: true }));
  diagramm(RAND, "Eintritte und Austritte", (x0, unten, w, h) => {
    const max = Math.max(1, ...j.monate.map((mm) => Math.max(mm.eintritte, mm.austritte)));
    const band = w / 12, sb = Math.min(7, band / 3);
    seite.drawRectangle({ x: x0 + w - 100, y: unten + h + 14, width: 6, height: 6, color: F.ein });
    schreib("Eintritte", x0 + w - 91, unten + h + 14, { groesse: 7, farbe: F.leise });
    seite.drawRectangle({ x: x0 + w - 50, y: unten + h + 14, width: 6, height: 6, color: F.aus });
    schreib("Austritte", x0 + w - 41, unten + h + 14, { groesse: 7, farbe: F.leise });
    j.monate.forEach((mm, i) => {
      const mitte = x0 + band * (i + 0.5);
      if (mm.monat === m.monat && mm.jahr === m.jahr) {
        seite.drawRectangle({ x: x0 + band * i + 1, y: unten - 2, width: band - 2, height: h + 6, color: F.markierung });
      }
      if (mm.zukunft) return;
      [[mm.eintritte, F.ein, mitte - sb - 0.5], [mm.austritte, F.aus, mitte + 0.5]].forEach(([v, farbe, x]) => {
        const hh = (v / max) * (h - 10);
        if (v > 0) {
          seite.drawRectangle({ x, y: unten, width: sb, height: hh, color: farbe });
          schreib(String(v), x + sb / 2, unten + hh + 2, { groesse: 6, mitte: true, font: fett });
        }
      });
    });
    seite.drawLine({ start: { x: x0, y: unten }, end: { x: x0 + w, y: unten }, thickness: 0.5, color: F.rand });
    achse(x0, unten, w);
  });
  diagramm(RAND + dw + 8, "Personalstand am Monatsende", (x0, unten, w, h) => {
    const da = j.monate.filter((mm) => !mm.zukunft);
    const max = Math.max(1, ...da.map((mm) => mm.standEnde));
    const px = (mm) => x0 + (w / 12) * (mm.monat - 0.5);
    const py = (v) => unten + (v / max) * (h - 12);
    da.forEach((mm, i) => {
      if (i) seite.drawLine({ start: { x: px(da[i - 1]), y: py(da[i - 1].standEnde) }, end: { x: px(mm), y: py(mm.standEnde) },
        thickness: 1.5, color: F.akzent });
    });
    da.forEach((mm, i) => {
      seite.drawCircle({ x: px(mm), y: py(mm.standEnde), size: 2.2, color: F.akzent });
      if (i === 0 || i === da.length - 1 || mm.monat === m.monat) {
        schreib(String(mm.standEnde), px(mm), py(mm.standEnde) + 5, { groesse: 6.5, font: fett, mitte: true });
      }
    });
    seite.drawLine({ start: { x: x0, y: unten }, end: { x: x0 + w, y: unten }, thickness: 0.5, color: F.rand });
    achse(x0, unten, w);
  });
  y -= dh + 8;

  // Tabelle
  const sp = [RAND + 6, RAND + 230, RAND + 310, RAND + 420, RAND + breite - 6];
  const tz = 13;
  const kopfzeile = () => {
    schreib("Monat", sp[0], y - 9, { font: fett, groesse: 8, farbe: F.leise });
    ["Eintritte", "Austritte", "Stand Monatsende", "Fluktuation"].forEach((t, i) =>
      schreib(t, sp[i + 1], y - 9, { font: fett, groesse: 8, farbe: F.leise, rechts: true }));
    y -= tz;
  };
  platz(tz * 3);
  y -= 4;
  kopfzeile();
  for (const mm of [...j.monate, null]) {
    if (y - tz < RAND + 24) { neueSeite(); kopfzeile(); }
    const summe = mm === null;
    if (!summe && mm.monat === m.monat && mm.jahr === m.jahr) {
      seite.drawRectangle({ x: RAND, y: y - tz + 3, width: breite, height: tz, color: F.markierung });
    }
    seite.drawLine({ start: { x: RAND, y: y + 3 }, end: { x: RAND + breite, y: y + 3 }, thickness: summe ? 0.9 : 0.3, color: F.rand });
    const f = summe ? fett : normal;
    if (summe) {
      schreib(`Jahr ${j.jahr}`, sp[0], y - 7, { font: f, groesse: 8 });
      [zahl(j.eintritte), zahl(j.austritte), `Ø ${zahl(j.durchschnitt, 1)}`, prozent(j.fluktuation)]
        .forEach((t, i) => schreib(t, sp[i + 1], y - 7, { font: f, groesse: 8, rechts: true }));
    } else {
      schreib(`${MONATE[mm.monat - 1]}${mm.laufend ? " (bis heute)" : ""}`, sp[0], y - 7, { font: f, groesse: 8 });
      if (mm.zukunft) schreib("noch nicht erreicht", sp[1], y - 7, { groesse: 8, farbe: F.leise, rechts: true });
      else [zahl(mm.eintritte), zahl(mm.austritte), zahl(mm.standEnde), prozent(mm.fluktuation)]
        .forEach((t, i) => schreib(t, sp[i + 1], y - 7, { font: f, groesse: 8, rechts: true }));
    }
    y -= tz;
  }

  // ------------------------------------------------ Personal heute
  const h = b.heute;
  ueberschrift("Personal heute");
  kacheln([
    { titel: "Im Dienst", wert: zahl(h.imDienst), zusatz: "laufende Dienstverhältnisse" },
    ...(h.vollzeitaequivalente !== null ? [{ titel: "Vollzeitäquivalente", wert: zahl(h.vollzeitaequivalente, 1),
      zusatz: `Wochenstunden ÷ ${zahl(h.vollzeitStunden)} Stunden` }] : []),
    { titel: "Ø Betriebszugehörigkeit", wert: h.jahre === null ? "–" : `${zahl(h.jahre, 1)} Jahre`, zusatz: "seit dem Eintritt" },
    ...(h.kosten ? [{ titel: "Brutto im Monat", wert: `€ ${zahl(h.kosten.summe)}`,
      zusatz: "laut Dienstzettel, ohne Zulagen" }] : []),
  ], 4);

  // Verteilungen in Spalten
  const vs = b.verteilungen;
  if (vs.length) {
    const vw = (breite - 8 * (vs.length - 1)) / vs.length;
    const zeilen = Math.max(...vs.map((v) => Math.min(v.eintraege.length, 8)));
    const vh = 26 + zeilen * 13;
    platz(vh + 8);
    vs.forEach((v, i) => {
      const x0 = RAND + i * (vw + 8);
      seite.drawRectangle({ x: x0, y: y - vh, width: vw, height: vh, borderColor: F.rand, borderWidth: 0.6 });
      schreib(v.titel, x0 + 8, y - 14, { font: fett, groesse: 9 });
      const summe = v.eintraege.reduce((s, e) => s + e.anzahl, 0);
      const max = v.eintraege[0].anzahl;
      v.eintraege.slice(0, 8).forEach((e, n) => {
        const yy = y - 30 - n * 13;
        schreib(kuerzen(e.name, normal, 7.5, vw * 0.36), x0 + 8, yy, { groesse: 7.5 });
        const bx = x0 + 8 + vw * 0.38, bw = vw * 0.24;
        seite.drawRectangle({ x: bx, y: yy, width: bw, height: 5, color: F.markierung });
        seite.drawRectangle({ x: bx, y: yy, width: Math.max(1, bw * (e.anzahl / max)), height: 5, color: F.akzent });
        schreib(`${e.anzahl} (${zahl((e.anzahl / summe) * 100)} %)`, x0 + vw - 8, yy, { groesse: 7.5, rechts: true, font: fett });
      });
    });
    y -= vh + 8;
  }

  // ------------------------------------------------ Was bald ansteht
  ueberschrift("Was bald ansteht", "nächste 30 Tage");
  const listen = b.hinweise;
  const lw = (breite - 8 * (listen.length - 1)) / listen.length;
  const lz = Math.max(1, ...listen.map((l) => Math.min(l.eintraege.length, 10)));
  const lh = 26 + lz * 12 + (listen.some((l) => l.eintraege.length > 10) ? 12 : 0);
  platz(lh + 8);
  listen.forEach((l, i) => {
    const x0 = RAND + i * (lw + 8);
    seite.drawRectangle({ x: x0, y: y - lh, width: lw, height: lh, borderColor: F.rand, borderWidth: 0.6 });
    schreib(kuerzen(`${l.titel} (${l.eintraege.length})`, fett, 7.5, lw - 14), x0 + 7, y - 14, { font: fett, groesse: 7.5 });
    if (!l.eintraege.length) schreib("Keine.", x0 + 8, y - 28, { groesse: 7.5, farbe: F.leise });
    l.eintraege.slice(0, 10).forEach((e, n) => {
      const yy = y - 28 - n * 12;
      schreib(kuerzen(e.name, normal, 7.5, lw - 66), x0 + 8, yy, { groesse: 7.5 });
      schreib(datum(e.datum), x0 + lw - 8, yy, { groesse: 7.5, rechts: true, farbe: F.leise });
    });
    if (l.eintraege.length > 10) schreib(`und ${l.eintraege.length - 10} weitere`, x0 + 8, y - 28 - 10 * 12, { groesse: 7, farbe: F.leise });
  });
  y -= lh + 8;

  // ------------------------------------------------ Erklärung
  platz(50);
  y -= 8;
  [
    "Fluktuation = Austritte ÷ durchschnittlicher Personalstand × 100. Monat: Durchschnitt aus Stand am Anfang und am Ende.",
    `12 Monate (${datum(m.zwoelf.von)} bis ${datum(m.zwoelf.bis)}) und Jahr: Durchschnitt der Monatsend-Stände.`,
    "Frühfluktuation = Anteil der Austritte, deren letzter Arbeitstag noch in der Probezeit lag.",
    "Eintritt = erster Arbeitstag, Austritt = letzter Arbeitstag. Gezählt werden nur Mitarbeiter, die diese Rolle sehen darf.",
  ].forEach((t) => { schreib(t, RAND, y, { groesse: 7, farbe: F.leise }); y -= 10; });

  // Fußzeile
  const seiten = dok.getPages();
  seiten.forEach((s, i) => {
    s.drawText(text(`${b.titel} · ${b.ort} · Protokoll-Nr. ${b.protokollNr} · Seite ${i + 1} von ${seiten.length}`, normal),
      { x: RAND, y: RAND - 18, size: 7, font: normal, color: F.leise });
  });
  return dok.save();
}
