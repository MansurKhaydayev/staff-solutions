// PDF für die Unterschriftsmappe: Dienstzettel und Onboarding-Unterlagen.
// Reines Modul: die PDF-Bibliothek (pdf-lib) und die Schrift werden übergeben, damit es in der
// Edge Function (Deno) und in den Tests (Node) gleich läuft.
// schrift = { fontkit, normal, fett }: gekürzte DejaVu Sans aus schrift.js (Latein, Griechisch, Kyrillisch).
//
// inhalt = { art, dokument_nr, inhalt_hash, kopf: { firma, adresse }, titel, untertitel?,
//            felder: [[bezeichnung, wert]], abschnitte: [{ titel, text }],
//            unterschrift_zeilen: [{ rolle, beschriftung }] }
// unterschriften = { mitarbeiter?: { png, ort, datum }, arbeitgeber?: { png, ort, datum },
//                    abgelehnt?: { ort, datum } }

const A4 = [595.28, 841.89];
const RAND = 56;          // 2 cm
const FUSS = 40;
const SCHRIFT = 10;
const ZEILE = 14;

export async function pdfErstellen(lib, inhalt, unterschriften = {}, schrift) {
  if (!schrift?.fontkit || !schrift.normal || !schrift.fett) throw new Error("Schrift fehlt");
  const { PDFDocument, rgb } = lib;
  const dok = await PDFDocument.create();
  dok.registerFontkit(schrift.fontkit);
  dok.setTitle(`${inhalt.titel} – ${inhalt.kopf?.firma || ""}`);
  dok.setCreator("Staff-Solutions");
  // subset: nur die benutzten Buchstaben kommen ins PDF, es bleibt klein
  const normal = await dok.embedFont(schrift.normal, { subset: true });
  const fett = await dok.embedFont(schrift.fett, { subset: true });
  const bekannt = new Map([normal, fett].map((f) => [f, new Set(f.getCharacterSet())]));
  const text = (t, font = normal) => textFuer(t, bekannt.get(font));
  const breite = A4[0] - 2 * RAND;
  const schwarz = rgb(0, 0, 0);
  const grau = rgb(0.35, 0.35, 0.35);

  let seite;
  let y;
  const neueSeite = () => {
    seite = dok.addPage(A4);
    y = A4[1] - RAND;
    // Kopf mit Firma und Adresse auf jeder Seite
    seite.drawText(text(inhalt.kopf?.firma, fett), { x: RAND, y, size: 9, font: fett, color: grau });
    y -= 12;
    seite.drawText(text(inhalt.kopf?.adresse), { x: RAND, y, size: 9, font: normal, color: grau });
    y -= 28;
  };
  const platz = (hoehe) => { if (y - hoehe < RAND + FUSS) neueSeite(); };

  // Text in Zeilen umbrechen, die in die Breite passen
  const umbrechen = (t, font, groesse, max) => {
    const zeilen = [];
    for (const absatz of text(t, font).split("\n")) {
      let zeile = "";
      for (const wort of absatz.split(/\s+/).filter(Boolean)) {
        const probe = zeile ? `${zeile} ${wort}` : wort;
        if (font.widthOfTextAtSize(probe, groesse) <= max) { zeile = probe; continue; }
        if (zeile) zeilen.push(zeile);
        // Ein Wort, das allein nicht in die Zeile passt, mit Bindestrich trennen
        // Gemessen wird nur ein Stück, das höchstens in die Zeile passen kann (kein Zeichen ist schmaler als
        // 0,2 × Schriftgröße), und die Trennstelle wird halbierend gesucht. So bleibt es auch bei
        // tausenden Zeichen ohne Leerzeichen schnell.
        const hoechstens = Math.ceil(max / (groesse * 0.2)) + 1;
        let rest = wort;
        while (rest.length > hoechstens || font.widthOfTextAtSize(rest, groesse) > max) {
          let lo = 1; // mindestens ein Zeichen je Zeile, sonst Endlosschleife
          let hi = Math.min(rest.length - 1, hoechstens);
          while (lo < hi) {
            const mitte = Math.ceil((lo + hi) / 2);
            if (font.widthOfTextAtSize(`${rest.slice(0, mitte)}-`, groesse) <= max) lo = mitte;
            else hi = mitte - 1;
          }
          zeilen.push(`${rest.slice(0, lo)}-`);
          rest = rest.slice(lo);
        }
        zeile = rest;
      }
      zeilen.push(zeile);
    }
    return zeilen;
  };
  const schreiben = (t, { font = normal, groesse = SCHRIFT, x = RAND, max = breite, farbe = schwarz } = {}) => {
    for (const z of umbrechen(t, font, groesse, max)) {
      platz(ZEILE);
      seite.drawText(z, { x, y, size: groesse, font, color: farbe });
      y -= ZEILE;
    }
  };

  neueSeite();
  schreiben(inhalt.titel, { font: fett, groesse: 16 });
  y -= 4;
  if (inhalt.untertitel) schreiben(inhalt.untertitel, { farbe: grau });
  y -= 10;

  // Felder als zweispaltige Tabelle
  const spalte = 130;
  for (const [bez, wert] of inhalt.felder || []) {
    const zeilen = umbrechen(wert, normal, SCHRIFT, breite - spalte);
    platz(ZEILE * zeilen.length + 4);
    seite.drawText(text(bez, fett), { x: RAND, y, size: SCHRIFT, font: fett });
    for (const z of zeilen) {
      seite.drawText(z, { x: RAND + spalte, y, size: SCHRIFT, font: normal });
      y -= ZEILE;
    }
    y -= 4;
  }
  y -= 8;

  for (const a of inhalt.abschnitte || []) {
    platz(ZEILE * 3);
    if (a.titel) schreiben(a.titel, { font: fett });
    schreiben(a.text);
    y -= 8;
  }

  // Unterschriften: alle Zeilen nebeneinander, gemeinsam auf einer Seite
  const zeilen = inhalt.unterschrift_zeilen || [];
  if (zeilen.length) {
    const hoehe = 120;
    platz(hoehe);
    y -= 10;
    const spaltenBreite = breite / zeilen.length;
    for (const [i, z] of zeilen.entries()) {
      const x = RAND + i * spaltenBreite;
      const u = unterschriften[z.rolle];
      const unten = y - 80;
      if (u?.ort || u?.datum) {
        seite.drawText(text(`${u.ort ?? ""}, ${u.datum ?? ""}`), { x, y, size: SCHRIFT, font: normal });
      }
      if (u?.png) {
        const bild = await dok.embedPng(u.png);
        const mass = bild.scaleToFit(Math.min(180, spaltenBreite - 20), 55);
        seite.drawImage(bild, { x, y: unten + 6, width: mass.width, height: mass.height });
      } else if (z.rolle === "mitarbeiter" && unterschriften.abgelehnt) {
        seite.drawText(text(`Abgelehnt am ${unterschriften.abgelehnt.datum ?? ""}`, fett), { x, y: unten + 20, size: SCHRIFT, font: fett });
      } else {
        seite.drawText("noch nicht unterschrieben", { x, y: unten + 20, size: 9, font: normal, color: grau });
      }
      seite.drawLine({ start: { x, y: unten }, end: { x: x + spaltenBreite - 24, y: unten }, thickness: 0.7, color: schwarz });
      seite.drawText(text(z.beschriftung), { x, y: unten - 12, size: 9, font: normal });
    }
    y -= hoehe;
  }

  // Fußzeile auf jeder Seite: Dokument-Nr., Fingerabdruck, Seitenzahl
  const seiten = dok.getPages();
  const nr = text(inhalt.dokument_nr).slice(0, 8);
  const fp = text(inhalt.inhalt_hash).slice(0, 12);
  seiten.forEach((s, i) => {
    s.drawText(`Dokument-Nr. ${nr} · Fingerabdruck des Inhalts ${fp} · Seite ${i + 1} von ${seiten.length}`,
      { x: RAND, y: RAND - 20, size: 8, font: normal, color: grau });
  });
  return dok.save();
}

// Zeichen, die die Schrift nicht kennt (z. B. Emoji, Chinesisch), werden zu „?“ – so entsteht das PDF immer.
// NFC setzt zerlegte Akzente (z. B. „C“ + Akut) zu einem Zeichen („Ć“) zusammen.
function textFuer(t, bekannt) {
  return [...String(t ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").normalize("NFC")]
    .map((z) => (z === "\n" || bekannt.has(z.codePointAt(0)) ? z : "?"))
    .join("");
}
