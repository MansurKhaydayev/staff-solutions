// Erzeugt Muster-PDFs mit erfundenen Demo-Daten zum Vorzeigen (Dienstzettel und eine Onboarding-Unterlage).
// Aufruf: NODE_PATH=$(npm root -g) node supabase/functions/mappe/muster.mjs docs/muster
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { pdfErstellen } from "./pdf.js";
import { DEJAVU_NORMAL, DEJAVU_FETT } from "./schrift.js";

const wurzel = process.env.NODE_PATH;
const require = createRequire(`${wurzel}/`);
const pdfLib = require(`${wurzel}/pdf-lib`);
const sharp = require(`${wurzel}/sharp`);
const fontkit = require(`${wurzel}/@pdf-lib/fontkit`);
const schrift = { fontkit: fontkit.default ?? fontkit, normal: DEJAVU_NORMAL, fett: DEJAVU_FETT };
const ziel = process.argv[2] || "docs/muster";
mkdirSync(ziel, { recursive: true });

// Demo-Unterschriften als Bild (geschwungene Linie, kein echter Namenszug)
const unterschrift = (pfad) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180">
  <path d="${pfad}" fill="none" stroke="#1a2a6c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`)).png().toBuffer();
const mitarbeiter = await unterschrift("M20 130 C 60 20, 90 20, 110 120 S 160 40, 190 110 S 250 150, 280 70 C 300 30, 330 140, 380 90 S 470 60, 560 100");
const arbeitgeber = await unterschrift("M30 120 C 80 40, 120 160, 170 70 S 240 30, 260 120 C 280 160, 330 40, 370 90 L 560 85");

const kopf = { firma: "DemoFit Steiermark GmbH", adresse: "Musterstraße 1, 8010 Graz" };
const DEMO = "(Demo-Text – der endgültige Wortlaut wird vom Lohnverrechner geprüft.)";

const dienstzettel = {
  art: "dienstzettel", dokument_nr: "7f3c91ab-demo", inhalt_hash: "5d41402abc4b2a76b9719d911017c592",
  kopf, titel: "DIENSTZETTEL", untertitel: "gemäß § 2 Arbeitsvertragsrechts-Anpassungsgesetz (AVRAG)",
  felder: [
    ["Arbeitgeber", "DemoFit Steiermark GmbH, Musterstraße 1, 8010 Graz"],
    ["Arbeitnehmer/in", "Frau Anna Berger, geboren am 14.03.1995\nProbegasse 7, 8700 Leoben"],
    ["Beginn", "01.12.2026"],
    ["Probezeit", "1 Monat"],
    ["Befristung", "befristet bis 28.02.2027; danach unbefristet, sofern nichts anderes vereinbart wird"],
    ["Arbeitsort", "DemoFit Leoben"],
    ["Tätigkeit", "Servicekraft"],
    ["Arbeitszeit", "Teilzeit, 20 Stunden pro Woche, verteilt auf 5 Tage"],
    ["Entgelt", "€ 1.300,00 brutto monatlich"],
    ["Sonderzahlungen", "13. und 14. Gehalt laut gesonderter Vereinbarung"],
  ],
  abschnitte: [
    { titel: "Fälligkeit des Entgelts", text: `Das Entgelt wird monatlich im Nachhinein bis zum 5. des Folgemonats auf das bekanntgegebene Konto überwiesen. ${DEMO}` },
    { titel: "Kündigung", text: `Für die Kündigung gelten die gesetzlichen Fristen und Termine. Während der Probezeit kann das Dienstverhältnis von beiden Seiten jederzeit gelöst werden. ${DEMO}` },
    { titel: "Urlaub", text: `Der Urlaubsanspruch richtet sich nach dem Urlaubsgesetz und beträgt 5 Wochen pro Arbeitsjahr. ${DEMO}` },
    { titel: "Mitarbeitervorsorgekasse", text: `Demo Vorsorgekasse AG, Beispielgasse 3, 1010 Wien. ${DEMO}` },
    { titel: "Sozialversicherung", text: `Österreichische Gesundheitskasse (ÖGK), Landesstelle Steiermark. ${DEMO}` },
  ],
  unterschrift_zeilen: [
    { rolle: "mitarbeiter", beschriftung: "Arbeitnehmer/in: Anna Berger" },
    { rolle: "arbeitgeber", beschriftung: "Arbeitgeber: DemoFit Steiermark GmbH" },
  ],
};
writeFileSync(`${ziel}/dienstzettel-muster.pdf`, await pdfErstellen(pdfLib, dienstzettel, {
  mitarbeiter: { png: mitarbeiter, ort: "Leoben", datum: "24.11.2026" },
  arbeitgeber: { png: arbeitgeber, ort: "Graz", datum: "25.11.2026" },
}, schrift));

const onboarding = {
  art: "onboarding", dokument_nr: "2b9e04cd-demo", inhalt_hash: "9e107d9d372bb6826bd81d3542a419d6",
  kopf, titel: "Einverständniserklärung Bildaufnahmen", untertitel: null,
  felder: [["Name", "Anna Berger"], ["Arbeitsort", "DemoFit Leoben"], ["Beginn", "01.12.2026"]],
  abschnitte: [
    { titel: null, text: `Ich bin einverstanden, dass im Rahmen meiner Tätigkeit Fotos und Videos von mir gemacht und für die Darstellung des Studios (Website, soziale Medien, Aushänge) verwendet werden. Diese Einwilligung ist freiwillig. Ich kann sie jederzeit ohne Angabe von Gründen widerrufen; der Widerruf gilt für die Zukunft. ${DEMO}` },
  ],
  unterschrift_zeilen: [{ rolle: "mitarbeiter", beschriftung: "Mitarbeiter/in: Anna Berger" }],
};
writeFileSync(`${ziel}/onboarding-muster.pdf`, await pdfErstellen(pdfLib, onboarding, {
  mitarbeiter: { png: mitarbeiter, ort: "Leoben", datum: "24.11.2026" },
}, schrift));
console.log(`Muster geschrieben nach ${ziel}`);
