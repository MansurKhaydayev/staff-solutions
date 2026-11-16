// Gleiche Regel wie app.fristende() in der Datenbank:
// Ende = Tag vor dem gleichen Kalendertag n Monate später.
// Gibt es diesen Tag nicht (31.01. + 3 Monate), endet die Frist am Monatsletzten.
// Die Datenbank rechnet beim Speichern selbst; das hier ist nur die Vorschau.

export function fristende(beginnIso, monate) {
  const [j, m, t] = beginnIso.split("-").map(Number);
  const zielMonat = m - 1 + monate;
  const letzterTag = new Date(Date.UTC(j, zielMonat + 1, 0)).getUTCDate();
  if (t > letzterTag) {
    return iso(new Date(Date.UTC(j, zielMonat, letzterTag)));
  }
  return iso(new Date(Date.UTC(j, zielMonat, t - 1)));
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

export function datumAT(isoDatum) {
  if (!isoDatum) return "";
  const [j, m, t] = isoDatum.split("-");
  return `${t}.${m}.${j}`;
}

export function euro(betrag) {
  return Number(betrag).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
