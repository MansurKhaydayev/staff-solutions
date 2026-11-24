// PDF für die Unterschriftsmappe: Dienstzettel und Onboarding-Unterlagen.
// Reines Modul: die PDF-Bibliothek (pdf-lib) wird übergeben, damit es in der Edge Function (Deno)
// und in den Tests (Node) gleich läuft.
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

export async function pdfErstellen(lib, inhalt, unterschriften = {}) {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const dok = await PDFDocument.create();
  dok.setTitle(`${inhalt.titel} – ${inhalt.kopf?.firma || ""}`);
  dok.setCreator("Staff-Solutions");
  const normal = await dok.embedFont(StandardFonts.Helvetica);
  const fett = await dok.embedFont(StandardFonts.HelveticaBold);
  const breite = A4[0] - 2 * RAND;
  const schwarz = rgb(0, 0, 0);
  const grau = rgb(0.35, 0.35, 0.35);

  let seite;
  let y;
  const neueSeite = () => {
    seite = dok.addPage(A4);
    y = A4[1] - RAND;
    // Kopf mit Firma und Adresse auf jeder Seite
    seite.drawText(text(inhalt.kopf?.firma), { x: RAND, y, size: 9, font: fett, color: grau });
    y -= 12;
    seite.drawText(text(inhalt.kopf?.adresse), { x: RAND, y, size: 9, font: normal, color: grau });
    y -= 28;
  };
  const platz = (hoehe) => { if (y - hoehe < RAND + FUSS) neueSeite(); };

  // Text in Zeilen umbrechen, die in die Breite passen
  const umbrechen = (t, font, groesse, max) => {
    const zeilen = [];
    for (const absatz of text(t).split("\n")) {
      let zeile = "";
      for (const wort of absatz.split(/\s+/).filter(Boolean)) {
        const probe = zeile ? `${zeile} ${wort}` : wort;
        if (font.widthOfTextAtSize(probe, groesse) <= max) zeile = probe;
        else { if (zeile) zeilen.push(zeile); zeile = wort; }
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
    seite.drawText(text(bez), { x: RAND, y, size: SCHRIFT, font: fett });
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
        seite.drawText(`${text(u.ort)}, ${text(u.datum)}`, { x, y, size: SCHRIFT, font: normal });
      }
      if (u?.png) {
        const bild = await dok.embedPng(u.png);
        const mass = bild.scaleToFit(Math.min(180, spaltenBreite - 20), 55);
        seite.drawImage(bild, { x, y: unten + 6, width: mass.width, height: mass.height });
      } else if (z.rolle === "mitarbeiter" && unterschriften.abgelehnt) {
        seite.drawText(`Abgelehnt am ${text(unterschriften.abgelehnt.datum)}`, { x, y: unten + 20, size: SCHRIFT, font: fett });
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

// Zeichen, die die Standardschrift (WinAnsi) nicht kennt, ersetzen. WinAnsi kennt Latin-1 (Umlaute, ß …)
// und zusätzlich € ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function text(t) {
  return [...String(t ?? "").replace(/\t/g, " ")]
    .map((z) => (z === "\n" || (z >= "\x20" && z <= "\x7E") || (z >= "\u00A0" && z <= "\u00FF") || WINANSI_EXTRA.includes(z) ? z : "?"))
    .join("");
}
