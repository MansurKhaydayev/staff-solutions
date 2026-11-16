// Erstellt zwei DEMO-Vorlagen für Einzelvereinbarungen (Leiterzulage, Sonderzahlungen).
// Aufruf: node demo_einzelvereinbarungen.js <ausgabe-ordner>
// Die Texte sind erfunden und nur für die Vorführung gedacht.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Header, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, TabStopType, HeightRule,
} = require("docx");

const ordner = process.argv[2];
const FONT = "Arial";
const SIZE = 22; // 11 pt
const BREITE = 9072; // A4 abzüglich 2,5 cm Rand je Seite

const absatz = (text, opts = {}) =>
  new Paragraph({
    spacing: { before: 0, after: 160 },
    alignment: opts.align,
    children: [new TextRun({ text, bold: opts.bold, size: opts.size || SIZE, font: FONT })],
  });

const ohneRand = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const zelle = (text, { fett = false, linie = false } = {}) =>
  new TableCell({
    width: { size: BREITE / 2, type: WidthType.DXA },
    borders: linie
      ? { ...ohneRand, top: { style: BorderStyle.SINGLE, size: 4, color: "000000" } }
      : ohneRand,
    margins: { left: 0, right: 284 },
    children: [new Paragraph({ children: text ? [new TextRun({ text, bold: fett, size: SIZE, font: FONT })] : [] })],
  });

const unterschriften = () =>
  new Table({
    width: { size: BREITE, type: WidthType.DXA },
    columnWidths: [BREITE / 2, BREITE / 2],
    rows: [
      new TableRow({ children: [zelle("Arbeitnehmer:", { fett: true }), zelle("Arbeitgeber:", { fett: true })] }),
      new TableRow({ height: { value: 1134, rule: HeightRule.ATLEAST }, children: [zelle(""), zelle("")] }),
      new TableRow({ children: [zelle("Unterschrift", { linie: true }), zelle("Unterschrift", { linie: true })] }),
      new TableRow({
        children: [zelle("Ort, Datum: {{ort_datum_arbeitnehmer}}"), zelle("Ort, Datum: {{ort_datum_arbeitgeber}}")],
      }),
    ],
  });

const kopf = () =>
  new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: BREITE }],
        children: [
          new TextRun({ text: "EINZELVEREINBARUNG", bold: true, size: SIZE, font: FONT }),
          new TextRun({ text: "\t{{gmbh_name}}", size: SIZE, font: FONT }),
        ],
      }),
    ],
  });

function vorlage(titel, inhalt) {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1417, right: 1417, bottom: 1134, left: 1417 },
          },
        },
        headers: { default: kopf() },
        children: [
          absatz(titel, { bold: true, size: 32, align: AlignmentType.CENTER }),
          absatz("abgeschlossen zwischen"),
          absatz("{{gmbh_name}}, {{gmbh_strasse}}, {{gmbh_plz_ort}} (Arbeitgeber)"),
          absatz("und"),
          absatz("{{name}}, {{strasse}}, {{plz_ort}} (Arbeitnehmer)"),
          absatz(""),
          absatz("Ergänzend zum Dienstvertrag mit Dienstantritt am {{dienstantritt}} wird Folgendes vereinbart:"),
          ...inhalt.map((t) => absatz(t)),
          absatz("Alle übrigen Bestimmungen des Dienstvertrags bleiben unverändert."),
          absatz(""),
          unterschriften(),
        ],
      },
    ],
  });
}

const dateien = {
  "Demo_Vorlage_Einzelvereinbarung_Leiterzulage.docx": vorlage("Einzelvereinbarung Leiterzulage", [
    "Für die Dauer der Tätigkeit als {{funktion}} erhält der Arbeitnehmer ab {{gueltig_ab}} " +
      "eine monatliche Zulage in Höhe von € {{betrag}} netto.",
    "Endet die Tätigkeit als {{funktion}}, entfällt die Zulage ab diesem Zeitpunkt.",
  ]),
  "Demo_Vorlage_Einzelvereinbarung_Sonderzahlungen.docx": vorlage("Einzelvereinbarung Sonderzahlungen", [
    "Der Arbeitnehmer erhält ab {{gueltig_ab}} zusätzlich zum laufenden Entgelt ein 13. und ein 14. Gehalt.",
    "Diese Vereinbarung wird freiwillig getroffen, da für das Dienstverhältnis kein Kollektivvertrag anzuwenden ist.",
  ]),
};

(async () => {
  for (const [name, doc] of Object.entries(dateien)) {
    fs.writeFileSync(path.join(ordner, name), await Packer.toBuffer(doc));
    console.log("Erstellt:", name);
  }
})();
