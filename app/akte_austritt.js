// Austritt und „nicht angetreten“ in der Akte: Status-Etikett, Melden (Leitung oder Büro),
// Bestätigen und Korrigieren (nur Büro), Verlauf der Meldungen. Ob etwas erlaubt ist, prüft die Datenbank;
// diese Seite zeigt nur die passenden Knöpfe. Nichts wird gelöscht: Korrekturen sind neue Fassungen.
import * as api from "./api.js";
import { heuteIso } from "./pruefungen.js";
import { $, text, datum } from "./hilfen.js";

export const PDF_FEHLER = "Das PDF konnte nicht erstellt werden. Unter „An Lohnverrechner übermitteln“ erneut versuchen.";

// Etikett zum Status (Werte aus app.dv_status). Rückgabe: { text, klasse } oder null bei „aktiv“.
export function statusEtikett(status, { austritt, abmeldung_bis: bis } = {}, heute = heuteIso()) {
  switch (status) {
    case "austritt_gemeldet": return { text: "Austritt gemeldet", klasse: "merkmal-frist" };
    case "nicht_angetreten_gemeldet": return { text: "Nicht angetreten gemeldet", klasse: "merkmal-frist" };
    case "austritt_bestaetigt":
      if (bis && bis < heute) return { text: `Austritt am ${datum(austritt)}, Abmeldefrist abgelaufen`, klasse: "merkmal-fehlt" };
      return { text: `Austritt am ${datum(austritt)}`, klasse: "merkmal-frist" };
    case "abgemeldet": return { text: "abgemeldet", klasse: "merkmal-aus" };
    case "storno_ausstaendig": return { text: "Storno ausständig", klasse: "merkmal-fehlt" };
    case "nicht_angetreten": return { text: "nicht angetreten", klasse: "merkmal-aus" };
    default: return null;
  }
}

export const etikettHtml = (e) => (e ? `<span class="merkmal ${e.klasse}">${text(e.text)}</span>` : "");

// Ist die Person (noch) im Dienst? Gemeldet zählt noch als aktiv, bestätigt bis inkl. letztem Arbeitstag.
export function imDienst(status, austritt, heute = heuteIso()) {
  if (["nicht_angetreten", "storno_ausstaendig"].includes(status)) return false;
  return !austritt || austritt >= heute;
}

let arten = null;
async function austrittsarten() {
  if (!arten) arten = await api.lesen("austrittsart", "select=schluessel,bezeichnung,reihenfolge,aktiv&order=reihenfolge,bezeichnung");
  return arten;
}
export function austrittsartenVergessen() { arten = null; }

// Bereich unter dem Akte-Kopf: Knöpfe, Formular, Hinweise und Verlauf
export async function austrittZeigen(bereich, k, stand, neuLaden) {
  const r = k.rechte;
  const status = k.status || "aktiv";
  const heute = heuteIso();
  const knoepfe = [];
  if (status === "aktiv" && r.austritt_melden) {
    knoepfe.push('<button type="button" class="knopf knopf-leise" id="austritt-melden">Austritt melden</button>');
    if (k.eintritt <= heute) knoepfe.push('<button type="button" class="knopf knopf-leise" id="nicht-angetreten">Nicht angetreten</button>');
  }
  if (r.buero && ["austritt_gemeldet", "nicht_angetreten_gemeldet"].includes(status) && k.meldung_id) {
    knoepfe.push('<button type="button" class="knopf knopf-haupt" id="austritt-bestaetigen">Bestätigen</button>');
  }
  if (r.buero && status !== "aktiv" && k.meldung_id) {
    knoepfe.push('<button type="button" class="knopf knopf-leise" id="austritt-korrigieren">Korrigieren</button>');
  }
  const buero = stand?.organisation?.buero_email;
  if (!r.buero && buero && r.austritt_melden) {
    const betreff = encodeURIComponent(`Rückfrage: ${k.nachname} ${k.vorname}`);
    knoepfe.push(`<a class="knopf knopf-leise" href="mailto:${text(encodeURIComponent(buero).replace(/%40/g, "@"))}?subject=${text(betreff)}">Rückfrage ans Büro</a>`);
  }
  bereich.innerHTML = `
    ${knoepfe.length ? `<div class="knopf-reihe austritt-knoepfe">${knoepfe.join("")}</div>` : ""}
    <div id="austritt-dialog"></div>
    <p class="fehler" id="austritt-hinweis" role="alert"></p>
    <div id="austritt-verlauf"></div>`;

  let verlauf = [];
  try {
    verlauf = await api.funktion("austritt_verlauf", { p_dienstverhaeltnis_id: k.dienstverhaeltnis_id }) || [];
  } catch {
    verlauf = [];   // ohne Verlauf bleiben die Knöpfe nutzbar
  }
  $("#austritt-verlauf", bereich).innerHTML = verlaufHtml(verlauf);
  const aktuell = verlauf.find((m) => m.id === k.meldung_id) || {};

  const dialog = $("#austritt-dialog", bereich);
  bereich.onclick = (e) => {
    const knopf = e.target.closest("button");
    if (!knopf) return;
    if (knopf.id === "austritt-melden") formular(dialog, "austritt", k, aktuell, neuLaden);
    if (knopf.id === "nicht-angetreten") formular(dialog, "nicht_angetreten", k, aktuell, neuLaden);
    if (knopf.id === "austritt-bestaetigen") formular(dialog, "bestaetigen", k, aktuell, neuLaden);
    if (knopf.id === "austritt-korrigieren") formular(dialog, "korrigieren", k, aktuell, neuLaden);
  };
}

function verlaufHtml(verlauf) {
  if (!verlauf.length) return "";
  const zeile = (m) => {
    const was = m.art === "nicht_angetreten" ? "Nicht angetreten" : `Austritt, letzter Arbeitstag ${datum(m.letzter_arbeitstag)}`;
    const teile = [
      m.zurueckgenommen ? "Zurückgenommen" : was,
      m.austrittsart_text, m.notiz ? `Notiz: ${m.notiz}` : null,
      `gemeldet von ${m.gemeldet_von_email || "–"} am ${datum(m.gemeldet_am)}`,
      m.bestaetigt_am ? `${m.korrektur_grund ? "korrigiert" : "bestätigt"} von ${m.bestaetigt_von_email || "–"} am ${datum(m.bestaetigt_am)}` : "noch nicht bestätigt",
      m.abweichung ? `Abweichung: ${m.abweichung}` : null,
      m.korrektur_grund ? `Grund: ${m.korrektur_grund}` : null,
    ].filter(Boolean).map(text).join(" · ");
    return m.ersetzt ? `<li class="verlauf-ersetzt"><s>${teile}</s> <small>(ersetzt)</small></li>` : `<li>${teile}</li>`;
  };
  return `<details class="austritt-verlauf akte-block"${verlauf.some((m) => !m.ersetzt) ? " open" : ""}>
    <summary>Verlauf Austritt (${verlauf.length})</summary><ul>${verlauf.map(zeile).join("")}</ul></details>`;
}

const TITEL = {
  austritt: "Austritt melden", nicht_angetreten: "Nicht angetreten melden",
  bestaetigen: "Meldung bestätigen", korrigieren: "Meldung korrigieren",
};

async function formular(dialog, modus, k, aktuell, neuLaden) {
  const r = k.rechte;
  const nichtAngetreten = modus === "nicht_angetreten" || (modus !== "austritt" && aktuell.art === "nicht_angetreten");
  const mitDatum = !nichtAngetreten;
  let liste = [];
  if (mitDatum) {
    try { liste = await austrittsarten(); } catch { liste = []; }
  }
  const vorbelegt = modus === "bestaetigen" || modus === "korrigieren";
  const tag = vorbelegt ? aktuell.letzter_arbeitstag || "" : "";
  const art = vorbelegt ? aktuell.austrittsart || "" : "";
  // inaktive Arten nur, wenn sie schon gewählt sind
  const auswahl = liste.filter((a) => a.aktiv || a.schluessel === art);
  dialog.innerHTML = `
    <form class="dialog" id="austritt-form" novalidate>
      <h3>${TITEL[modus]}</h3>
      ${modus === "korrigieren" ? '<p class="einleitung klein">Die bisherige Fassung bleibt im Verlauf erhalten.</p>' : ""}
      ${modus === "korrigieren" ? `<label class="ankreuzen"><input type="checkbox" name="zuruecknehmen"${nichtAngetreten ? " checked disabled" : ""}>
        ${nichtAngetreten ? "„Nicht angetreten“ zurücknehmen" : "Austritt zurücknehmen (Person bleibt)"}</label>` : ""}
      <div class="reihe" data-teil="datum"${mitDatum ? "" : " hidden"}>
        <label class="feld"><span>Letzter Arbeitstag</span><input type="date" name="tag" value="${text(tag)}"></label>
        <label class="feld"><span>Art des Austritts</span><select name="austrittsart"><option value="">Bitte wählen</option>${
          auswahl.map((a) => `<option value="${text(a.schluessel)}"${a.schluessel === art ? " selected" : ""}>${text(a.bezeichnung)}</option>`).join("")}</select></label>
      </div>
      ${modus === "austritt" || modus === "nicht_angetreten"
        ? `<label class="feld breit"><span>${nichtAngetreten ? "Grund" : "Notiz (freiwillig)"}</span><input name="notiz" maxlength="300"></label>` : ""}
      ${modus === "korrigieren" ? '<label class="feld breit"><span>Grund der Korrektur</span><input name="grund" maxlength="300"></label>' : ""}
      ${modus === "austritt" && r.buero ? '<label class="ankreuzen"><input type="checkbox" name="gleich" checked> gleich bestätigen</label>' : ""}
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">${modus === "bestaetigen" ? "Bestätigen" : modus === "korrigieren" ? "Korrektur speichern" : "Melden"}</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#austritt-form", dialog);
  const e = form.elements;
  const zurueck = () => e.zuruecknehmen?.checked;
  const datumTeil = form.querySelector("[data-teil=datum]");
  e.zuruecknehmen?.addEventListener("change", () => { datumTeil.hidden = !mitDatum || zurueck(); });
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { dialog.innerHTML = ""; });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fehler = form.querySelector(".fehler");
    const knopf = form.querySelector("button[type=submit]");
    fehler.textContent = "";
    const werte = { tag: e.tag.value || null, art: e.austrittsart.value || null };
    const pruefen = mitDatum && !zurueck();
    if (pruefen && !werte.tag) { fehler.textContent = "Bitte den letzten Arbeitstag angeben."; return; }
    if (pruefen && !werte.art) { fehler.textContent = "Bitte die Art des Austritts wählen."; return; }
    if (modus === "nicht_angetreten" && !e.notiz.value.trim()) { fehler.textContent = "Bitte einen Grund angeben."; return; }
    if (modus === "korrigieren" && !e.grund.value.trim()) { fehler.textContent = "Bitte einen Grund angeben."; return; }
    knopf.disabled = true;
    let id;
    let pdf = false;
    try {
      if (modus === "austritt" || modus === "nicht_angetreten") {
        const gleich = Boolean(e.gleich?.checked);
        id = await api.funktion("austritt_melden", { p_dienstverhaeltnis_id: k.dienstverhaeltnis_id, p_art: modus,
          p_letzter_arbeitstag: modus === "austritt" ? werte.tag : null, p_austrittsart: modus === "austritt" ? werte.art : null,
          p_notiz: e.notiz.value.trim() || null, p_gleich_bestaetigen: gleich });
        pdf = gleich;
      } else if (modus === "bestaetigen") {
        id = await api.funktion("austritt_bestaetigen", { p_meldung_id: k.meldung_id,
          p_letzter_arbeitstag: mitDatum ? werte.tag : null, p_austrittsart: mitDatum ? werte.art : null });
        pdf = true;
      } else {
        id = await api.funktion("austritt_korrigieren", { p_meldung_id: k.meldung_id, p_grund: e.grund.value.trim(),
          p_letzter_arbeitstag: zurueck() ? null : werte.tag, p_austrittsart: zurueck() ? null : werte.art, p_zuruecknehmen: Boolean(zurueck()) });
        pdf = true;
      }
    } catch (f) {
      fehler.textContent = f.message;
      knopf.disabled = false;
      return;
    }
    // Meldungs-PDF für den Lohnverrechner gleich erzeugen. Gibt es nichts zu schicken (z. B. nie angemeldet), ist das kein Fehler.
    let hinweis = "";
    if (pdf && r.buero && id) {
      try {
        await api.mappe("meldung", { meldung_id: id });
      } catch (f) {
        if (!/nichts an den Lohnverrechner/.test(f.message)) hinweis = PDF_FEHLER;
      }
    }
    dialog.innerHTML = "";
    await neuLaden();
    if (hinweis) { const h = document.querySelector("#austritt-hinweis"); if (h) h.textContent = hinweis; }
  });
  (e.tag && mitDatum ? e.tag : form.querySelector("input, select"))?.focus();
}
