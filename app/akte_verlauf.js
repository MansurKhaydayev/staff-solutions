// Reiter „Anstellung & Verlauf“: alle Stände mit gültig ab, Stundenanpassung eintragen, Storno.
import * as api from "./api.js";
import { stundenanpassungPruefen } from "./pruefungen.js";
import { $, text, ART, stunden, geld, datum } from "./hilfen.js";

export async function zeigen(ziel, kopf, stand, neuLaden) {
  const r = kopf.rechte;
  const dv = kopf.dienstverhaeltnis_id;
  const [staende, entgelte] = await Promise.all([
    api.lesen("vertragsstand", `select=*&dienstverhaeltnis_id=eq.${dv}&order=gueltig_ab`),
    r.entgelt ? api.lesen("entgelt", `select=*&dienstverhaeltnis_id=eq.${dv}&order=gueltig_ab`) : Promise.resolve([]),
  ]);
  const entgeltZu = (s) => entgelte.find((e) => e.vertragsstand_id === s.id);
  const ohneNachweis = new Set(kopf.nachweis_fehlt || []);

  const vereinbarung = (s) => {
    if (s.storniert_am) return `storniert: ${text(s.storno_grund)}`;
    if (s.gueltig_ab === kopf.eintritt) return "Dienstzettel";
    if (ohneNachweis.has(s.gueltig_ab)) return '<span class="merkmal merkmal-fehlt">Nachweis fehlt</span>';
    return "vorhanden";
  };

  ziel.innerHTML = `
    ${r.buero ? '<div class="aktionen"><button type="button" class="knopf knopf-haupt" id="anpassung-oeffnen">Stundenanpassung eintragen</button></div>' : ""}
    <div id="anpassung-bereich"></div>
    <div class="tabelle-rahmen">
      <table class="tabelle" id="verlauf-tabelle">
        <thead><tr>
          <th scope="col">Gültig ab</th><th scope="col">Beschäftigung</th>
          <th scope="col" class="zahl">Stunden pro Woche</th><th scope="col" class="zahl">Tage</th>
          ${r.entgelt ? '<th scope="col" class="zahl">Netto</th><th scope="col" class="zahl">Brutto</th>' : ""}
          <th scope="col">Vereinbarung</th>
          ${r.buero ? '<th scope="col"><span class="sr-only">Aktion</span></th>' : ""}
        </tr></thead>
        <tbody>${staende.map((s) => {
          const e = entgeltZu(s);
          const stornierbar = r.buero && !s.storniert_am && s.gueltig_ab !== kopf.eintritt;
          return `<tr${s.storniert_am ? ' class="storniert"' : ""}>
            <td>${datum(s.gueltig_ab)}</td>
            <td>${text(ART[s.beschaeftigungsart] || s.beschaeftigungsart)}</td>
            <td class="zahl">${Number(s.wochenstunden).toLocaleString("de-DE")}</td>
            <td class="zahl">${text(s.arbeitstage_woche ?? "–")}</td>
            ${r.entgelt ? `<td class="zahl">${e ? geld(e.netto) : "–"}</td><td class="zahl">${e ? geld(e.brutto) : "–"}</td>` : ""}
            <td class="grund">${vereinbarung(s)}</td>
            ${r.buero ? `<td>${stornierbar ? `<button type="button" class="knopf knopf-leise" data-storno="${text(s.id)}">Stornieren</button>` : ""}</td>` : ""}
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>
    <div id="storno-bereich"></div>`;

  if (!r.buero) return;
  const aktuell = staende.filter((s) => !s.storniert_am);
  const letzter = aktuell.at(-1);
  const letzterNetto = letzter && entgeltZu(letzter)?.netto;

  $("#anpassung-oeffnen").addEventListener("click", () =>
    formularZeigen($("#anpassung-bereich"), { kopf, stand, letzter, letzterNetto, neuLaden }));
  ziel.querySelectorAll("button[data-storno]").forEach((k) => k.addEventListener("click", () =>
    stornoZeigen($("#storno-bereich"), k.dataset.storno, staende.find((s) => s.id === k.dataset.storno), neuLaden)));
}

// Brutto aus der Brutto-Tabelle für Netto, Arbeitsort und Datum (null = noch offen)
function bruttoFuer(stand, standortId, netto, tag) {
  const zone = stand.standorte.find((s) => s.id === standortId)?.tarifzone_id;
  const treffer = stand.bruttoTabelle
    .filter((b) => b.tarifzone_id === zone && Number(b.netto) === Number(netto) && b.gueltig_ab <= tag)
    .sort((a, b) => b.gueltig_ab.localeCompare(a.gueltig_ab))[0];
  return treffer ? treffer.brutto : null;
}

function formularZeigen(bereich, { kopf, stand, letzter, letzterNetto, neuLaden }) {
  bereich.innerHTML = `
    <form class="dialog" id="stundenanpassung" novalidate>
      <h3>Stundenanpassung eintragen</h3>
      <p class="einleitung klein">Jede Änderung der Arbeitszeit – auch eine Reduktion – ist eine eigene Vereinbarung.
        Nach dem Speichern bitte die unterschriebene Vereinbarung unter „Dokumente“ hochladen.</p>
      <div class="reihe">
        <label class="feld"><span>Gültig ab</span><input type="date" name="gueltig_ab" required>
          <small class="feld-fehler" data-fehler="gueltig_ab"></small></label>
        <label class="feld"><span>Beschäftigung</span>
          <select name="beschaeftigungsart">${Object.entries(ART).map(([w, t]) =>
            `<option value="${w}"${w === letzter?.beschaeftigungsart ? " selected" : ""}>${t}</option>`).join("")}</select>
          <small class="feld-fehler" data-fehler="beschaeftigungsart"></small></label>
        <label class="feld schmal"><span>Stunden pro Woche</span>
          <input type="number" name="wochenstunden" min="1" max="60" step="0.5" inputmode="decimal" value="${text(letzter ? Number(letzter.wochenstunden) : "")}">
          <small class="feld-fehler" data-fehler="wochenstunden"></small></label>
        <label class="feld schmal"><span>Arbeitstage pro Woche</span>
          <input type="number" name="arbeitstage" min="1" max="6" step="1" inputmode="numeric" value="${text(letzter?.arbeitstage_woche ?? "")}">
          <small class="feld-fehler" data-fehler="arbeitstage"></small></label>
        <label class="feld schmal"><span>Netto pro Monat (€)</span>
          <input type="number" name="netto" min="1" step="0.01" inputmode="decimal" value="${text(letzterNetto ?? "")}">
          <small class="feld-fehler" data-fehler="netto"></small></label>
      </div>
      <p class="hinweis" id="anpassung-vorschau" aria-live="polite"></p>
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">Anpassung speichern</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#stundenanpassung");
  const werte = () => {
    const e = form.elements;
    return { gueltig_ab: e.gueltig_ab.value, beschaeftigungsart: e.beschaeftigungsart.value,
      wochenstunden: e.wochenstunden.value, arbeitstage: e.arbeitstage.value, netto: e.netto.value };
  };
  const vorschau = () => {
    const w = werte();
    const teile = [];
    if (letzter && w.wochenstunden) {
      teile.push(`${Number(letzter.wochenstunden).toLocaleString("de-DE")} → ${stunden(w.wochenstunden)}`);
    }
    if (w.netto && stand.bruttoTabelle.length) {
      const b = bruttoFuer(stand, kopf.standort_id, w.netto, w.gueltig_ab || "9999-12-31");
      teile.push(b === null ? "Brutto noch offen (nicht in der Brutto-Tabelle)" : `Brutto ${geld(b)}`);
    }
    $("#anpassung-vorschau").textContent = teile.join(", ");
  };
  const pruefen = () => {
    const f = stundenanpassungPruefen(werte(), stand.organisation, {
      eintritt: kopf.eintritt, letzterStand: letzter?.gueltig_ab, austritt: kopf.austritt });
    form.querySelectorAll("[data-fehler]").forEach((el) => {
      el.textContent = f[el.dataset.fehler] || "";
      const feld = form.elements[el.dataset.fehler];
      if (feld) feld.setAttribute("aria-invalid", f[el.dataset.fehler] ? "true" : "false");
    });
    return f;
  };
  let versucht = false;
  form.addEventListener("input", () => { vorschau(); if (versucht) pruefen(); });
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.querySelector(".fehler").textContent = "";
    versucht = true;
    if (Object.keys(pruefen()).length) return;
    const w = werte();
    const knopf = form.querySelector("button[type=submit]");
    knopf.disabled = true;
    try {
      await api.funktion("stunden_anpassen", {
        p_dienstverhaeltnis_id: kopf.dienstverhaeltnis_id, p_gueltig_ab: w.gueltig_ab,
        p_beschaeftigungsart: w.beschaeftigungsart, p_wochenstunden: Number(w.wochenstunden),
        p_arbeitstage_woche: Number(w.arbeitstage), p_netto: Number(w.netto) });
      await neuLaden();
    } catch (fehler) {
      form.querySelector(".fehler").textContent = fehler.message;
      knopf.disabled = false;
    }
  });
  vorschau();
  form.elements.gueltig_ab.focus();
}

function stornoZeigen(bereich, standId, s, neuLaden) {
  bereich.innerHTML = `
    <form class="dialog" id="storno-form" novalidate>
      <h3>Stand ab ${datum(s.gueltig_ab)} stornieren</h3>
      <p class="einleitung klein">Der Stand bleibt sichtbar, zählt aber nicht mehr. Bitte den Grund angeben.</p>
      <label class="feld"><span>Grund</span><input type="text" name="grund" maxlength="200"></label>
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">Stornieren</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#storno-form");
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const grund = form.elements.grund.value.trim();
    if (!grund) { form.querySelector(".fehler").textContent = "Bitte einen Grund angeben."; return; }
    try {
      await api.funktion("stand_stornieren", { p_vertragsstand_id: standId, p_grund: grund });
      await neuLaden();
    } catch (fehler) {
      form.querySelector(".fehler").textContent = fehler.message;
    }
  });
  form.elements.grund.focus();
}
