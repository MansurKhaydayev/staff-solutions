// Kennzahlen für die Startseite. Reine Rechnungen ohne Seitenzugriff, damit sie in Node testbar sind.
// Grundlage sind die Zeilen aus mitarbeiter_verzeichnis (je Rolle schon nach Rechten gefiltert).
// Alle Datumswerte sind Texte "JJJJ-MM-TT" (Wiener Datum), damit es keine Zeitzonen-Fehler gibt.

const zwei = (n) => String(n).padStart(2, "0");
const isoAus = (j, m, t) => `${j}-${zwei(m)}-${zwei(t)}`;
const tageImMonat = (j, m) => new Date(Date.UTC(j, m, 0)).getUTCDate();

export const monatsEnde = (jahr, monat) => isoAus(jahr, monat, tageImMonat(jahr, monat));
export const monatsAnfang = (jahr, monat) => isoAus(jahr, monat, 1);

export function monatPlus(jahr, monat, n) {
  const index = jahr * 12 + (monat - 1) + n;
  return { jahr: Math.floor(index / 12), monat: (index % 12) + 1 };
}

export function tagPlus(iso, tage) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

const tageZwischen = (von, bis) => (Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86400000;

// Letzter Tag der Probezeit: ein Monat ab 10.03. endet am 09.04.; ab 31.01. am 28.02.
export function probezeitEnde(eintritt, monate) {
  const [j, m, t] = eintritt.split("-").map(Number);
  const z = monatPlus(j, m, monate);
  const max = tageImMonat(z.jahr, z.monat);
  if (t > max) return isoAus(z.jahr, z.monat, max);
  return tagPlus(isoAus(z.jahr, z.monat, t), -1);
}

// Wer nie angetreten ist, zählt weder als Eintritt noch als Austritt (Status kommt mit dem Austritt-Modul).
// „storno_ausstaendig“ ist ebenfalls ein bestätigtes „nicht angetreten“ (nur die Storno-Bestätigung fehlt noch).
const NICHT_ANGETRETEN = new Set(["nicht_angetreten", "storno_ausstaendig"]);
export const zaehlbar = (zeilen) => zeilen.filter((z) => !NICHT_ANGETRETEN.has(z.status));

// Im Dienst an einem Tag: ab dem Eintritt bis einschließlich letztem Arbeitstag (Austritt)
export const imDienst = (z, tag) => z.eintritt <= tag && (!z.austritt || z.austritt >= tag);

// Personalstand nach Ende eines Tages (wer an dem Tag austritt, zählt nicht mehr)
export const bestandNach = (zeilen, tag) =>
  zeilen.filter((z) => z.eintritt <= tag && (!z.austritt || z.austritt > tag)).length;

const zwischen = (wert, von, bis) => Boolean(wert) && wert >= von && wert <= bis;
const prozent = (teil, ganzes) => (ganzes > 0 ? (teil / ganzes) * 100 : null);

// Ein Monat. Der laufende Monat zählt bis heute; was danach im Monat geplant ist, steht extra.
export function monatsZahlen(zeilen, jahr, monat, heute) {
  const anfang = monatsAnfang(jahr, monat);
  const ende = monatsEnde(jahr, monat);
  if (anfang > heute) {
    return { jahr, monat, zukunft: true, laufend: false, eintritte: 0, austritte: 0, eintritteGeplant: 0,
      austritteGeplant: 0, standAnfang: null, standEnde: null, fluktuation: null };
  }
  const laufend = ende > heute;
  const stichtag = laufend ? heute : ende;
  const standAnfang = bestandNach(zeilen, tagPlus(anfang, -1));
  const standEnde = bestandNach(zeilen, stichtag);
  const eintritte = zeilen.filter((z) => zwischen(z.eintritt, anfang, stichtag)).length;
  const austritte = zeilen.filter((z) => zwischen(z.austritt, anfang, stichtag)).length;
  const nachHeute = tagPlus(stichtag, 1);
  return {
    jahr, monat, zukunft: false, laufend, stichtag, eintritte, austritte, standAnfang, standEnde,
    eintritteGeplant: laufend ? zeilen.filter((z) => zwischen(z.eintritt, nachHeute, ende)).length : 0,
    austritteGeplant: laufend ? zeilen.filter((z) => zwischen(z.austritt, nachHeute, ende)).length : 0,
    fluktuation: prozent(austritte, (standAnfang + standEnde) / 2),
  };
}

// Mehrere Monate zusammen: Fluktuation = Austritte ÷ durchschnittlicher Stand am Monatsende × 100
function zusammenfassen(monate) {
  const vergangen = monate.filter((m) => !m.zukunft);
  const durchschnitt = vergangen.length
    ? vergangen.reduce((s, m) => s + m.standEnde, 0) / vergangen.length : null;
  const austritte = vergangen.reduce((s, m) => s + m.austritte, 0);
  return {
    eintritte: vergangen.reduce((s, m) => s + m.eintritte, 0),
    austritte,
    durchschnitt,
    fluktuation: durchschnitt ? prozent(austritte, durchschnitt) : null,
  };
}

// Kalenderjahr Jänner bis Dezember
export function jahresZahlen(zeilen, jahr, heute) {
  const monate = Array.from({ length: 12 }, (_, i) => monatsZahlen(zeilen, jahr, i + 1, heute));
  return { jahr, monate, ...zusammenfassen(monate), von: monatsAnfang(jahr, 1),
    bis: [monatsEnde(jahr, 12), heute].sort()[0] };
}

// Die 12 Monate bis einschließlich des gewählten Monats (gleitend, auch über den Jahreswechsel)
export function zwoelfMonate(zeilen, jahr, monat, heute) {
  const monate = [];
  for (let n = -11; n <= 0; n++) {
    const z = monatPlus(jahr, monat, n);
    monate.push(monatsZahlen(zeilen, z.jahr, z.monat, heute));
  }
  const erster = monatPlus(jahr, monat, -11);
  return { monate, ...zusammenfassen(monate), von: monatsAnfang(erster.jahr, erster.monat),
    bis: [monatsEnde(jahr, monat), heute].sort()[0] };
}

// Anteil der Austritte, die noch in der Probezeit waren
export function fruehfluktuation(zeilen, probezeitMonate, von, bis) {
  const weg = zeilen.filter((z) => zwischen(z.austritt, von, bis));
  const frueh = weg.filter((z) => z.austritt <= probezeitEnde(z.eintritt, probezeitMonate));
  return { austritte: weg.length, inProbezeit: frueh.length, anteil: prozent(frueh.length, weg.length) };
}

// Wer heute im Dienst ist, gruppiert nach einem Feld. Leere Werte (fehlendes Recht) zählen nicht.
export function verteilung(zeilen, feld, heute) {
  const zaehler = new Map();
  for (const z of zeilen) {
    if (!imDienst(z, heute) || z[feld] === null || z[feld] === undefined) continue;
    zaehler.set(z[feld], (zaehler.get(z[feld]) || 0) + 1);
  }
  return [...zaehler].map(([wert, anzahl]) => ({ wert, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || String(a.wert).localeCompare(String(b.wert)));
}

// Was in den nächsten Tagen Aufmerksamkeit braucht
export function hinweise(zeilen, heute, probezeitMonate, tage = 30) {
  const bis = tagPlus(heute, tage);
  const nochDa = (z) => !z.austritt || z.austritt >= heute;
  const nachDatum = (a, b) => a.bis.localeCompare(b.bis);
  return {
    befristung: zeilen.filter((z) => nochDa(z) && zwischen(z.befristet_bis, heute, bis)
        && (!z.austritt || z.austritt > z.befristet_bis))
      .map((z) => ({ ...z, bis: z.befristet_bis })).sort(nachDatum),
    probezeit: zeilen.map((z) => ({ ...z, bis: probezeitEnde(z.eintritt, probezeitMonate) }))
      .filter((z) => nochDa(z) && z.eintritt <= heute && zwischen(z.bis, heute, bis)).sort(nachDatum),
    nichtAngemeldet: zeilen.filter((z) => nochDa(z) && z.angemeldet === false)
      .sort((a, b) => a.eintritt.localeCompare(b.eintritt)),
    kommend: zeilen.filter((z) => zwischen(z.eintritt, tagPlus(heute, 1), bis))
      .sort((a, b) => a.eintritt.localeCompare(b.eintritt)),
  };
}

// Vollzeitäquivalente: Summe der Wochenstunden ÷ Vollzeit. Ohne Stunden (fehlendes Recht) keine Zahl.
export function vollzeitaequivalente(zeilen, heute, vollzeitStunden) {
  const aktiv = zeilen.filter((z) => imDienst(z, heute));
  if (!aktiv.length || aktiv.some((z) => z.wochenstunden === null || z.wochenstunden === undefined)) return null;
  return aktiv.reduce((s, z) => s + Number(z.wochenstunden), 0) / vollzeitStunden;
}

// Durchschnittliche Betriebszugehörigkeit in Jahren (nur wer heute im Dienst ist)
export function betriebszugehoerigkeit(zeilen, heute) {
  const aktiv = zeilen.filter((z) => imDienst(z, heute));
  if (!aktiv.length) return null;
  return aktiv.reduce((s, z) => s + tageZwischen(z.eintritt, heute), 0) / aktiv.length / 365.25;
}

// Monatliches Brutto laut Dienstzettel: je aktivem Dienstverhältnis der heute gültige, nicht stornierte Betrag
export function personalkosten(entgelt, zeilen, heute) {
  const aktiv = new Set(zeilen.filter((z) => imDienst(z, heute)).map((z) => z.dienstverhaeltnis_id));
  const gueltig = new Map();
  for (const e of entgelt) {
    if (!aktiv.has(e.dienstverhaeltnis_id) || e.storniert_am || e.gueltig_ab > heute) continue;
    const bisher = gueltig.get(e.dienstverhaeltnis_id);
    if (!bisher || e.gueltig_ab > bisher.gueltig_ab) gueltig.set(e.dienstverhaeltnis_id, e);
  }
  return { summe: [...gueltig.values()].reduce((s, e) => s + Number(e.brutto), 0), anzahl: gueltig.size };
}
