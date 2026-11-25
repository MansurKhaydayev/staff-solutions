// Inhalt der Personalanalyse: dieselben Zahlen wie auf der Startseite, fertig für das PDF.
// Reines Modul ohne Netz und ohne Deno, damit es in Node getestet werden kann.
// kennzahlen.js ist eine Kopie von app/kennzahlen.js (ein Test prüft, dass beide gleich sind).
import * as k from "./kennzahlen.js";

export const MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
  "September", "Oktober", "November", "Dezember"];
export const ART = { vollzeit: "Vollzeit", teilzeit: "Teilzeit", geringfuegig: "Geringfügig" };

// d = { zeilen, entgelt|null, organisation, standorte, funktionen, recht, rolle, jahr, monat, standort|null,
//       heute, jetzt (Text "TT.MM.JJJJ HH:MM"), protokollNr }
export function berichtErstellen(d) {
  const alle = k.zaehlbar(d.zeilen);
  const zeilen = d.standort ? alle.filter((z) => z.standort_id === d.standort) : alle;
  const probezeit = d.organisation?.probezeit_monate ?? 1;
  const vollzeit = d.organisation?.vollzeit_stunden || 40;
  const { jahr, monat, heute } = d;

  const m = k.monatsZahlen(zeilen, jahr, monat, heute);
  const vor = k.monatPlus(jahr, monat, -1);
  const vm = k.monatsZahlen(zeilen, vor.jahr, vor.monat, heute);
  const zwoelf = k.zwoelfMonate(zeilen, jahr, monat, heute);
  const j = k.jahresZahlen(zeilen, jahr, heute);
  const ortName = (id) => d.standorte.find((s) => s.id === id)?.name || "unbekannt";
  const funktionName = (id) => d.funktionen.find((f) => f.id === id)?.name || "unbekannt";
  const namen = (eintraege, name) => eintraege.map((e) => ({ name: name(e.wert), anzahl: e.anzahl }));

  return {
    titel: `Personalanalyse ${MONATE[monat - 1]} ${jahr}`,
    firma: d.organisation?.name || "",
    ort: d.standort ? ortName(d.standort) : "alle Arbeitsorte",
    rolle: d.rolle || "",
    erstellt: d.jetzt,
    protokollNr: d.protokollNr,
    ohneAustritte: !alle.some((z) => z.austritt),
    monat: { ...m, name: `${MONATE[monat - 1]} ${jahr}`, vormonat: vm, zwoelf,
      frueh: k.fruehfluktuation(zeilen, probezeit, zwoelf.von, zwoelf.bis) },
    jahr: { ...j, frueh: k.fruehfluktuation(zeilen, probezeit, j.von, j.bis) },
    heute: {
      imDienst: zeilen.filter((z) => k.imDienst(z, heute)).length,
      vollzeitaequivalente: d.recht?.sieht_personendaten ? k.vollzeitaequivalente(zeilen, heute, vollzeit) : null,
      vollzeitStunden: vollzeit,
      jahre: k.betriebszugehoerigkeit(zeilen, heute),
      kosten: d.recht?.sieht_entgelt && d.entgelt ? k.personalkosten(d.entgelt, zeilen, heute) : null,
    },
    verteilungen: [
      { titel: "Nach Arbeitsort", eintraege: namen(k.verteilung(zeilen, "standort_id", heute), ortName) },
      { titel: "Nach Beschäftigungsart", eintraege: namen(k.verteilung(zeilen, "beschaeftigungsart", heute), (w) => ART[w] || w) },
      { titel: "Nach Funktion", eintraege: namen(k.verteilung(zeilen, "funktion_id", heute), funktionName) },
    ].filter((v) => v.eintraege.length),
    hinweise: (() => {
      const h = k.hinweise(zeilen, heute, probezeit, 30);
      const liste = (titel, eintraege, datum) => ({ titel, eintraege: eintraege.map((z) =>
        ({ name: `${z.nachname} ${z.vorname}`, datum: datum(z) })) });
      return [
        liste("Noch nicht angemeldet", h.nichtAngemeldet, (z) => z.eintritt),
        liste("Kommende Antritte", h.kommend, (z) => z.eintritt),
        liste("Probezeit endet", h.probezeit, (z) => z.bis),
        ...(d.recht?.sieht_personendaten ? [liste("Befristung endet", h.befristung, (z) => z.bis)] : []),
      ];
    })(),
  };
}
