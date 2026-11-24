// Seite „Offene Punkte“: Wem fehlt was? Die Datenbank liefert nur Punkte, die die Rolle sehen darf.
import * as api from "./api.js";
import { $, text, datum } from "./hilfen.js";

const ARTEN = {
  onboarding: "Onboarding fehlt",
  klaerung: "Klärung mit Geschäftsführung",
  nachweis_stunden: "Nachweis fehlt: Stundenanpassung",
  nachweis_stammdaten: "Nachweis fehlt: Stammdatenänderung",
  sv_nummer: "Versicherungsnummer nachreichen",
  dienstzettel: "Dienstzettel fehlt",
  arbeitgeber: "Arbeitgeber-Unterschrift fehlt",
  uebermittlung: "An Lohnverrechner übermitteln",
  dringend: "Dringende Anmeldung",
};

export function punktText(p) {
  switch (p.art) {
    case "onboarding": return `Onboarding fehlt: ${p.beschreibung}`;
    case "klaerung": return `Klärung mit Geschäftsführung: ${p.beschreibung}`;
    case "nachweis_stunden": return `Nachweis fehlt: Stundenanpassung ab ${datum(p.datum)}`;
    case "nachweis_stammdaten": return `Nachweis fehlt: Änderung ${p.beschreibung} ab ${datum(p.datum)}`;
    default: return p.beschreibung;
  }
}

let punkte = [];
let eingerichtet = false;

export async function offenePunkteZeigen(stand) {
  if (!eingerichtet) {
    $("#offen-filter").addEventListener("change", () => zeichnen(stand));
    $("#offen-filter").addEventListener("submit", (e) => e.preventDefault());
    eingerichtet = true;
  }
  const f = $("#offen-filter").elements;
  if (f.standort.options.length <= 1) {
    f.standort.innerHTML = '<option value="">Alle</option>' + stand.standorte.map((s) =>
      `<option value="${text(s.id)}">${text(s.vertragsbezeichnung || s.name)}</option>`).join("");
    f.art.innerHTML = '<option value="">Alle</option>' + Object.entries(ARTEN).map(([w, t]) =>
      `<option value="${w}">${text(t)}</option>`).join("");
  }
  $("#offen-liste").innerHTML = '<p class="leer-zustand">Wird geladen …</p>';
  try {
    punkte = await api.funktion("offene_punkte");
  } catch (fehler) {
    punkte = [];
    $("#offen-liste").innerHTML = `<p class="fehler">Die Liste konnte nicht geladen werden: ${text(fehler.message)}</p>`;
    return;
  }
  zeichnen(stand);
}

function zeichnen(stand) {
  const f = $("#offen-filter").elements;
  const gefiltert = punkte.filter((p) => (!f.standort.value || p.standort_id === f.standort.value) && (!f.art.value || p.art === f.art.value));
  const personen = new Map();
  for (const p of gefiltert) {
    if (!personen.has(p.dienstverhaeltnis_id)) personen.set(p.dienstverhaeltnis_id, { ...p, punkte: [] });
    personen.get(p.dienstverhaeltnis_id).punkte.push(p);
  }
  const ort = new Map(stand.standorte.map((s) => [s.id, s.vertragsbezeichnung || s.name]));
  const sortiert = [...personen.values()].sort((a, b) => `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, "de"));
  $("#offen-anzahl").textContent = punkte.length ? `${gefiltert.length} ${gefiltert.length === 1 ? "offener Punkt" : "offene Punkte"} bei ` +
    `${sortiert.length} ${sortiert.length === 1 ? "Person" : "Personen"}` : "";
  $("#offen-leer").hidden = sortiert.length > 0;
  $("#offen-leer").textContent = punkte.length ? "Keine Treffer für diese Filter." : "Alles erledigt.";
  $("#offen-liste").innerHTML = sortiert.map((m) => `
    <section class="offen-person akte-block">
      <h2><a class="name" href="#akte/${text(m.dienstverhaeltnis_id)}/uebersicht">${text(`${m.nachname} ${m.vorname}`)}</a>
        <small>${text(ort.get(m.standort_id) || "")}</small></h2>
      <ul>${m.punkte.map((p) => `<li class="punkt-${text(p.art)}">${text(punktText(p))}</li>`).join("")}</ul>
    </section>`).join("");
}
