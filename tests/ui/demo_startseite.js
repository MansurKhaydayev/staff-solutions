// Erfundene Demo-Belegschaft für die Startseite (keine echten Personen).
// Immer gleich (fester Zufallsstartwert), Daten relativ zu heute, damit Tests jeden Tag gleich funktionieren.
const { plus } = require("./mock.js");

const VORNAMEN = ["Anna", "Lukas", "Sophie", "David", "Lena", "Jonas", "Marie", "Elias", "Laura", "Felix", "Sarah",
  "Paul", "Julia", "Simon", "Hannah", "Tobias", "Lea", "Fabian", "Nina", "Florian", "Katharina", "Matteo", "Emilia",
  "Noah", "Valentina", "Leon", "Clara", "Jakob", "Amelie", "Moritz", "Ivana", "Mehmet", "Zeynep", "Luka", "Ana"];
const NACHNAMEN = ["Berger", "Gruber", "Huber", "Mayer", "Wagner", "Bauer", "Pichler", "Moser", "Hofer", "Leitner",
  "Steiner", "Fuchs", "Eder", "Schmid", "Winkler", "Weber", "Brunner", "Lang", "Novak", "Horvat", "Yılmaz", "Kovačević"];

function zufall(start) {
  let s = start;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

// Liefert { zeilen, entgelt } wie mitarbeiter_verzeichnis bzw. die Tabelle entgelt (volle Rechte)
function belegschaft() {
  const r = zufall(42);
  const wahl = (liste) => liste[Math.floor(r() * liste.length)];
  const zeilen = [], entgelt = [];
  const orte = ["s1", "s1", "s2", "s2", "s3", "s3", "s3", "s4"];
  const add = (eintrittTage, austrittTage, mehr = {}) => {
    const n = zeilen.length + 1;
    const standort = mehr.standort_id || wahl(orte);
    const buero = standort === "s4";
    const art = buero ? "vollzeit" : wahl(["teilzeit", "teilzeit", "geringfuegig", "vollzeit"]);
    const stunden = { vollzeit: 40, teilzeit: wahl([20, 25, 30]), geringfuegig: wahl([6, 8, 10]) }[art];
    const z = {
      dienstverhaeltnis_id: `dv${n}`, mitarbeiter_id: `m${n}`, vorname: wahl(VORNAMEN), nachname: wahl(NACHNAMEN),
      funktion_id: buero ? "f4" : wahl(["f1", "f2", "f2", "f2", "f3"]), standort_id: standort,
      eintritt: plus(eintrittTage), austritt: austrittTage === null ? null : plus(austrittTage),
      erfasst_am: `${plus(eintrittTage - 3)}T09:00:00Z`, telefon: "+43 660 0000000", email: `person${n}@demo.invalid`,
      beschaeftigungsart: art, wochenstunden: stunden, befristet_bis: null, angemeldet: true, ...mehr,
    };
    zeilen.push(z);
    entgelt.push({ dienstverhaeltnis_id: z.dienstverhaeltnis_id, brutto: Math.round(stunden * 4.33 * 15.5),
      gueltig_ab: z.eintritt, storniert_am: null });
    return z;
  };
  // Stammbelegschaft seit ein bis drei Jahren
  for (let i = 0; i < 34; i++) add(-400 - Math.floor(r() * 700), null);
  // Laufende Eintritte im letzten Jahr, ein Teil davon wieder ausgetreten
  for (let i = 0; i < 22; i++) {
    const ein = -10 - Math.floor(r() * 340);
    const raus = r();
    let aus = null;
    if (raus < 0.2) aus = Math.min(-1, ein + 5 + Math.floor(r() * 24));          // in der Probezeit weg
    else if (raus < 0.3) aus = Math.min(-1, ein + 60 + Math.floor(r() * 200));   // später weg
    add(ein, aus);
  }
  // Austritte aus der Stammbelegschaft verteilt übers Jahr
  for (let i = 0; i < 4; i++) add(-800 - Math.floor(r() * 300), -5 - Math.floor(r() * 330));
  // Was bald ansteht
  add(-3, null, { angemeldet: false });
  add(4, null, { angemeldet: false });
  add(9, null, { angemeldet: false });
  add(-60, null, { befristet_bis: plus(12) });
  add(-80, null, { befristet_bis: plus(25) });
  add(-20, null);
  return { zeilen, entgelt };
}

// So liefert die Datenbank das Verzeichnis je Rolle (Reichweite und Spalten nach Rechten)
function verzeichnisFuer(zeilen, recht, zugeordnet = ["s1"]) {
  return zeilen
    .filter((z) => recht.reichweite === "alle" || (recht.reichweite === "zugeordnet" && zugeordnet.includes(z.standort_id)))
    .map((z) => ({
      ...z,
      telefon: recht.sieht_kontakt ? z.telefon : null, email: recht.sieht_kontakt ? z.email : null,
      beschaeftigungsart: recht.sieht_personendaten ? z.beschaeftigungsart : null,
      wochenstunden: recht.sieht_personendaten ? z.wochenstunden : null,
      befristet_bis: recht.sieht_personendaten ? z.befristet_bis : null,
    }));
}

module.exports = { belegschaft, verzeichnisFuer };
