// Sammelmail an den Lohnverrechner: Dateinamen, Betreff, Text und Mail-Link (mailto:).
// Reines Modul ohne Seitenzugriff, damit es mit Node getestet werden kann.
// Die App verschickt nie selbst: Der Link öffnet nur das Mailprogramm, die PDFs hängt man selbst an.
// Im Text stehen nur Art, Name, GmbH und Datum – nie Versicherungsnummer, Bank oder Gehalt.

const ART = {
  anmeldung: ["Anmeldung", "Anmeldungen"],
  abmeldung: ["Abmeldung", "Abmeldungen"],
  storno: ["Storno", "Stornos"],
  korrektur: ["Korrektur", "Korrekturen"],
};
const REIHENFOLGE = ["anmeldung", "abmeldung", "storno", "korrektur"];
const MAX_LINK = 1800;   // längere mailto:-Links schneiden manche Mailprogramme ab

const ERSATZ = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss", Đ: "D", đ: "d", Ł: "L", ł: "l",
  Ø: "O", ø: "o", Æ: "Ae", æ: "ae", Œ: "Oe", œ: "oe", ı: "i" };

// nur A–Z, 0–9 und Bindestrich; Akzente weg (ć → c), Umlaute ausgeschrieben (ü → ue)
function teil(t) {
  return String(t ?? "")
    .replace(/[äöüÄÖÜßĐđŁłØøÆæŒœı]/g, (z) => ERSATZ[z])
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const datumDe = (iso) => {
  const [j, m, t] = String(iso ?? "").slice(0, 10).split("-");
  return j && m && t ? `${t}.${m}.${j}` : "";
};

export function dateiname({ datum, lohnverrechner, art, nachname, vorname }) {
  const bez = ART[art]?.[0] ?? art;
  return `${String(datum).slice(0, 10)}_${teil(lohnverrechner)}_${teil(bez)}_${teil(`${nachname} ${vorname}`)}.pdf`;
}

export function betreff(faelle, datum) {
  const anzahl = (a) => faelle.filter((f) => f.art === a).length;
  const teile = REIHENFOLGE.filter((a) => anzahl(a) > 0)
    .map((a) => `${anzahl(a)} ${anzahl(a) === 1 ? ART[a][0] : ART[a][1]}`);
  return `Staff-Solutions: ${teile.join(", ")}, ${datumDe(datum)}`;
}

export function mailText(faelle, { maxZeilen = 30 } = {}) {
  const zeilen = faelle.slice(0, maxZeilen)
    .map((f) => `- ${ART[f.art]?.[0] ?? f.art}: ${f.nachname} ${f.vorname}, ${f.gesellschaft}, ${datumDe(f.datum)}`);
  const rest = faelle.length - zeilen.length;
  if (rest > 0) zeilen.push(`… und ${rest} weitere, siehe Anhänge`);
  return ["Guten Tag,", "", "anbei die folgenden Unterlagen:", "", ...zeilen, "", "Mit freundlichen Grüßen", ""].join("\r\n");
}

export function mailLink({ an, faelle, datum }) {
  const kopf = `mailto:${encodeURIComponent(an ?? "")}?subject=${encodeURIComponent(betreff(faelle, datum))}&body=`;
  for (let max = Math.min(30, faelle.length); max >= 0; max--) {
    const link = kopf + encodeURIComponent(mailText(faelle, { maxZeilen: max }));
    if (link.length <= MAX_LINK || max === 0) return link;
  }
  return kopf;
}
