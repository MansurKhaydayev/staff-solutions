// Fristregel für den Dienstantritt (gleiche Regel wie app.fruehester_dienstantritt in der Datenbank).
// Übermittelt bis zur Stichzeit → frühestens nach 1 + „Tage dazwischen (vor)“ Tagen, danach 1 + „(nach)“.
// Gerechnet wird immer in Wiener Zeit, unabhängig von der Zeitzone des Geräts.

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function wienTeile(zeitpunkt) {
  const t = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(zeitpunkt).map((p) => [p.type, p.value]));
  return { datum: `${t.year}-${t.month}-${t.day}`,
    // Millisekunden hängen nicht von der Zeitzone ab
    sekunden: Number(t.hour) * 3600 + Number(t.minute) * 60 + Number(t.second) + zeitpunkt.getUTCMilliseconds() / 1000 };
}

const plusTage = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function fruehesterDienstantritt(jetzt, regeln) {
  // Sekundengenau wie in der Datenbank (p_zeitpunkt::time <= anmeldung_stichzeit): 12:00:00 zählt noch, 12:00:01 nicht mehr
  const { datum, sekunden } = wienTeile(jetzt);
  const [h, m = 0, s = 0] = String(regeln.anmeldung_stichzeit || "12:00").split(":").map(Number);
  const vorStichzeit = sekunden <= h * 3600 + m * 60 + s;
  const dazwischen = Number(vorStichzeit ? regeln.tage_dazwischen_vor ?? 0 : regeln.tage_dazwischen_nach ?? 1);
  return plusTage(datum, 1 + dazwischen);
}

export const heuteWien = (jetzt = new Date()) => wienTeile(jetzt).datum;

export function fristMeldung(iso) {
  const tag = WOCHENTAGE[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  return `Zu kurzfristig. Frühester Dienstantritt ist ${tag}, ${iso.split("-").reverse().join(".")}. ` +
    "Bei dringendem Bedarf „Dringende Anmeldung“ wählen.";
}
