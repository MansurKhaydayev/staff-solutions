// Prüfregeln für den Dienstzettel. Dieselben Regeln prüft auch die Datenbank;
// hier stehen sie, damit Fehler schon beim Tippen auffallen.

export function svNummerGueltig(nr) {
  const s = String(nr).replace(/\s+/g, "");
  if (!/^\d{10}$/.test(s)) return false;
  const gewichte = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6];
  const summe = [...s].reduce((acc, z, i) => acc + Number(z) * gewichte[i], 0);
  return summe % 11 === Number(s[3]);
}

export function ibanGueltig(iban) {
  const s = String(iban).replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const ziffern = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const z of ziffern) rest = (rest * 10 + Number(z)) % 97;
  return rest === 1;
}

export function alterAm(geburtIso, stichtagIso) {
  const [gj, gm, gt] = geburtIso.split("-").map(Number);
  const [sj, sm, st] = stichtagIso.split("-").map(Number);
  return sj - gj - (sm < gm || (sm === gm && st < gt) ? 1 : 0);
}

export function heuteIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function tageVersetzt(iso, tage) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

const zahl = (n) => Number(n).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const geld = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Liefert { feldname: "Meldung" } für alle Probleme.
// w = Formularwerte, regeln = Einstellungen der Firma, auswahl = gewählte Funktion/Standort
export function dienstzettelPruefen(w, regeln, auswahl) {
  const f = {};
  const pflicht = (name, wert, meldung) => {
    if (wert === null || wert === undefined || String(wert).trim() === "") f[name] = meldung;
  };

  pflicht("funktion", w.funktion, "Bitte eine Funktion wählen.");
  pflicht("standort", w.standort, "Bitte einen Arbeitsort wählen.");
  pflicht("eintritt", w.eintritt, "Dienstantritt fehlt.");
  pflicht("beschaeftigungsart", w.beschaeftigungsart, "Bitte eine Beschäftigungsart wählen.");
  pflicht("wochenstunden", w.wochenstunden, "Stunden pro Woche fehlen.");
  pflicht("arbeitstage", w.arbeitstage, "Arbeitstage pro Woche fehlen.");
  pflicht("anrede", w.anrede, "Anrede fehlt.");
  pflicht("vorname", w.vorname, "Vorname fehlt.");
  pflicht("nachname", w.nachname, "Nachname fehlt.");
  pflicht("geburtsdatum", w.geburtsdatum, "Geburtsdatum fehlt.");
  pflicht("strasse", w.strasse, "Straße fehlt.");
  pflicht("plz", w.plz, "PLZ fehlt.");
  pflicht("ort", w.ort, "Ort fehlt.");
  pflicht("telefon", w.telefon, "Telefonnummer fehlt.");
  pflicht("email", w.email, "E-Mail fehlt.");
  pflicht("staatsangehoerigkeit", w.staatsangehoerigkeit, "Staatsangehörigkeit fehlt.");
  pflicht("netto", w.netto, "Netto pro Monat fehlt.");
  pflicht("iban", w.iban, "IBAN fehlt.");
  if (!w.svNachreichen) {
    pflicht("sv_nummer", w.svNummer, "Versicherungsnummer fehlt. Gibt es noch keine, unten ankreuzen.");
  }

  // Funktion und Arbeitsort
  const { funktion, standort } = auswahl;
  if (funktion && standort) {
    if (funktion.bereich === "buero" && standort.art !== "buero") {
      f.standort = `${funktion.name} arbeitet im Büro. Bitte das Büro wählen.`;
    } else if (funktion.bereich === "studio" && standort.art === "buero") {
      f.standort = `${funktion.name} arbeitet in einem Studio, nicht im Büro.`;
    }
  }

  // Arbeitszeit
  const stunden = w.wochenstunden === "" ? null : Number(w.wochenstunden);
  const tage = w.arbeitstage === "" ? null : Number(w.arbeitstage);
  if (tage !== null && (!Number.isInteger(tage) || tage < 1 || tage > 6)) {
    f.arbeitstage = "1 bis 6 Arbeitstage pro Woche.";
  }
  if (stunden !== null && stunden <= 0) f.wochenstunden = "Stunden müssen größer als 0 sein.";
  if (stunden && tage && !f.arbeitstage && stunden / tage > regeln.max_stunden_tag) {
    f.wochenstunden = `${zahl(stunden)} Stunden an ${tage} ${tage === 1 ? "Tag" : "Tagen"} sind ` +
      `${zahl(stunden / tage)} Stunden pro Tag. Höchstens ${zahl(regeln.max_stunden_tag)} sind möglich.`;
  }
  if (stunden && !f.wochenstunden) {
    if (w.beschaeftigungsart === "vollzeit" && stunden !== Number(regeln.vollzeit_stunden)) {
      f.wochenstunden = `Vollzeit sind ${zahl(regeln.vollzeit_stunden)} Stunden. Bei weniger bitte Teilzeit wählen.`;
    }
    if (["teilzeit", "geringfuegig"].includes(w.beschaeftigungsart) && stunden >= Number(regeln.vollzeit_stunden)) {
      f.wochenstunden = `Mit ${zahl(stunden)} Stunden ist das Vollzeit.`;
    }
  }

  // Daten
  const heute = heuteIso();
  if (w.eintritt) {
    if (w.eintritt < tageVersetzt(heute, -90)) f.eintritt = "Liegt mehr als 3 Monate zurück.";
    if (w.eintritt > tageVersetzt(heute, 365)) f.eintritt = "Liegt mehr als 1 Jahr in der Zukunft.";
  }
  if (w.geburtsdatum && w.eintritt) {
    const alter = alterAm(w.geburtsdatum, w.eintritt);
    if (alter < 15) f.geburtsdatum = `Zum Dienstantritt erst ${alter} Jahre alt.`;
    else if (alter > 80) f.geburtsdatum = "Bitte prüfen, das Alter wäre über 80.";
  }

  // Kontakt und Adresse
  if (w.plz && !/^\d{4,5}$/.test(w.plz.trim())) f.plz = "4 oder 5 Ziffern.";
  if (w.telefon && !/^\+?[0-9 /()-]{6,}$/.test(w.telefon.trim())) f.telefon = "Nur Ziffern, Leerzeichen und +.";
  if (w.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) f.email = "Bitte eine gültige E-Mail-Adresse.";

  // Entgelt
  const netto = w.netto === "" ? null : Number(w.netto);
  if (netto !== null && netto <= 0) f.netto = "Muss größer als 0 sein.";
  if (netto && w.beschaeftigungsart === "geringfuegig" && regeln.geringfuegig_grenze &&
      netto > Number(regeln.geringfuegig_grenze)) {
    f.netto = `Geringfügig geht nur bis € ${geld(regeln.geringfuegig_grenze)} pro Monat.`;
  }
  if (w.leiterzulage !== "" && w.leiterzulage !== null && Number(w.leiterzulage) <= 0) {
    f.leiterzulage = "Größer als 0 oder leer lassen.";
  }

  // Lohnverrechnung
  if (!w.svNachreichen && w.svNummer && !svNummerGueltig(w.svNummer)) {
    f.sv_nummer = "Ungültig: Die Prüfziffer stimmt nicht. Bitte jede Ziffer vergleichen.";
  }
  if (w.iban && !ibanGueltig(w.iban)) f.iban = "Ungültig: Bitte jede Stelle vergleichen.";

  return f;
}
