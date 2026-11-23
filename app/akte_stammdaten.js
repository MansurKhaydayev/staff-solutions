// Stammdaten in der Akte: Reiter „Lohnverrechnung“ und „Änderung eintragen“ (auch für Personendaten).
// Es gibt kein freies Bearbeiten: Jede Änderung wird mit altem Wert, Grund und Nachweis gespeichert.
import * as api from "./api.js";
import { stammdatenFeldPruefen, heuteIso } from "./pruefungen.js";
import { hochladenDialog } from "./akte_dokumente.js";
import { $, text, datum } from "./hilfen.js";

const FELDER = {
  personendaten: [
    ["anrede", "Anrede", "auswahl"], ["vorname", "Vorname"], ["nachname", "Nachname"], ["geburtsdatum", "Geburtsdatum", "date"],
    ["strasse", "Straße"], ["plz", "PLZ"], ["ort", "Ort"], ["telefon", "Telefon", "tel"], ["email", "E-Mail", "email"],
  ],
  lohnverrechnung: [
    ["sv_nummer", "Versicherungsnummer"], ["iban", "IBAN"], ["bic", "BIC"], ["staatsangehoerigkeit", "Staatsangehörigkeit"],
  ],
};
const NAME = Object.fromEntries([...FELDER.personendaten, ...FELDER.lohnverrechnung].map(([f, n]) => [f, n]));

// Gleiche Schreibweise wie in der Datenbank (für den Vergleich alt/neu und zum Senden)
export function normalisiert(feld, wert) {
  const w = String(wert ?? "").trim();
  if (feld === "iban") return w.replace(/\s+/g, "").toUpperCase();
  if (feld === "bic") return w.toUpperCase();
  if (feld === "sv_nummer") return w.replace(/\s+/g, "");
  if (feld === "email") return w.toLowerCase();
  return w;
}

const ibanText = (i) => (i ? i.replace(/(.{4})/g, "$1 ").trim() : "–");
const svText = (s) => (s ? `${s.slice(0, 4)} ${s.slice(4)}` : "–");
const anzeige = (feld, w) => (feld === "iban" ? ibanText(w) : feld === "sv_nummer" ? svText(w)
  : feld === "geburtsdatum" ? datum(w) : w || "–");

// Frühere Werte eines Feldes als Liste
function verlauf(aenderungen, feld) {
  const alte = aenderungen.filter((a) => a.feld === feld && !a.ist_ergaenzung);
  if (!alte.length) return "";
  return `<ul class="frueher-werte">${alte.map((a) =>
    `<li>bis ${datum(a.gueltig_ab)}: ${text(anzeige(feld, a.alt))} <small>(${text(a.grund)})</small></li>`).join("")}</ul>`;
}

// Reiter „Lohnverrechnung“
export async function zeigen(ziel, kopf, stand, neuLaden) {
  const r = kopf.rechte;
  const ma = kopf.mitarbeiter_id;
  const [[sens = {}], aenderungen] = await Promise.all([
    api.lesen("mitarbeiter_sensibel", `select=*&mitarbeiter_id=eq.${ma}`),
    api.lesen("stammdaten_aenderung", `select=*&mitarbeiter_id=eq.${ma}&stufe=eq.lohnverrechnung&order=created_at.desc`),
  ]);
  const sv = sens.sv_nummer ? text(svText(sens.sv_nummer))
    : `wird nachgereicht${r.buero ? ' <button type="button" class="knopf knopf-leise" id="sv-oeffnen">Nummer eintragen</button>' : ""}`;
  ziel.innerHTML = `
    ${r.buero ? '<div class="aktionen"><button type="button" class="knopf knopf-haupt" id="lohn-aendern">Änderung eintragen</button></div>' : ""}
    <div id="lohn-dialog"></div>
    <section class="akte-block" id="lohn-angaben"><h2>Lohnverrechnung</h2>
      <dl class="angaben">
        <div><dt>Versicherungsnummer</dt><dd>${sv}${verlauf(aenderungen, "sv_nummer")}</dd></div>
        <div><dt>IBAN</dt><dd>${text(ibanText(sens.iban))}${verlauf(aenderungen, "iban")}</dd></div>
        <div><dt>BIC</dt><dd>${text(sens.bic || "–")}${verlauf(aenderungen, "bic")}</dd></div>
        <div><dt>Staatsangehörigkeit</dt><dd>${text(sens.staatsangehoerigkeit || "–")}${verlauf(aenderungen, "staatsangehoerigkeit")}</dd></div>
      </dl>
    </section>`;
  if (!r.buero) return;
  $("#lohn-aendern").addEventListener("click", () =>
    aenderungDialog($("#lohn-dialog"), "lohnverrechnung", sens, kopf, stand, neuLaden));
  $("#sv-oeffnen")?.addEventListener("click", () => svDialog($("#lohn-dialog"), kopf, neuLaden));
}

// Knopf „Änderung eintragen“ und frühere Angaben im Block „Person“ der Übersicht
export async function aenderungKnopf(ziel, stufe, kopf, stand, neuLaden, dialogZiel = null) {
  const aenderungen = await api.lesen("stammdaten_aenderung",
    `select=*&mitarbeiter_id=eq.${kopf.mitarbeiter_id}&stufe=eq.${stufe}&order=created_at.desc`).catch(() => []);
  const frueher = FELDER[stufe].map(([f, n]) => {
    const v = verlauf(aenderungen, f);
    return v ? `<div><dt>${text(n)} früher</dt><dd>${v}</dd></div>` : "";
  }).join("");
  ziel.innerHTML = `${frueher ? `<dl class="angaben frueher-angaben">${frueher}</dl>` : ""}
    <button type="button" class="knopf knopf-leise">Änderung eintragen</button><div class="dialog-platz"></div>`;
  const platz = dialogZiel || ziel.querySelector(".dialog-platz");
  ziel.querySelector("button").addEventListener("click", () => {
    aenderungDialog(platz, stufe, kopf, kopf, stand, neuLaden);
    platz.scrollIntoView({ block: "nearest" });
  });
}

export function aenderungDialog(bereich, stufe, aktuell, kopf, stand, fertig) {
  const felder = FELDER[stufe].filter(([f]) => f !== "sv_nummer" || aktuell.sv_nummer);
  const eingabe = ([f, , typ]) => {
    const wert = aktuell[f] ?? "";
    if (typ === "auswahl") {
      // Ohne bisherige Anrede eine leere Wahl anbieten, damit sie nicht ungewollt mitgeändert wird
      const optionen = ["Frau", "Herr", "Divers"].includes(wert) ? ["Frau", "Herr", "Divers"] : ["", "Frau", "Herr", "Divers"];
      return `<select name="${f}">${optionen.map((o) =>
        `<option value="${o}"${o === wert ? " selected" : ""}>${o || "–"}</option>`).join("")}</select>`;
    }
    const anzeigeWert = f === "iban" ? ibanText(wert) : f === "sv_nummer" ? svText(wert) : wert;
    return `<input type="${typ || "text"}" name="${f}" value="${text(anzeigeWert)}" autocomplete="off">`;
  };
  bereich.innerHTML = `
    <form class="dialog" id="aenderung-form" novalidate>
      <h3>Änderung eintragen: ${stufe === "personendaten" ? "Person und Kontakt" : "Lohnverrechnung"}</h3>
      <p class="einleitung klein">Nur die Felder ändern, die sich geändert haben. Der bisherige Wert bleibt in der Akte sichtbar.
        Danach den Nachweis hochladen (z. B. Meldezettel, Heiratsurkunde, Bankbestätigung).</p>
      <div class="reihe">${felder.map((x) => `<label class="feld"><span>${text(x[1])}</span>${eingabe(x)}
        <small class="feld-fehler" data-fehler="${x[0]}"></small></label>`).join("")}</div>
      <div class="reihe">
        <label class="feld"><span>Gültig ab</span><input type="date" name="gueltig_ab" value="${heuteIso()}" max="${heuteIso()}">
          <small class="feld-fehler" data-fehler="gueltig_ab"></small></label>
        <label class="feld breit"><span>Grund</span><input type="text" name="grund" maxlength="200" placeholder="z. B. Heirat, Umzug, Bankwechsel">
          <small class="feld-fehler" data-fehler="grund"></small></label>
      </div>
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">Änderung speichern</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#aenderung-form");
  const e = form.elements;
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fehler = {};
    const werte = {};
    for (const [f] of felder) {
      const neu = normalisiert(f, e[f].value);
      if (neu === normalisiert(f, aktuell[f] ?? "")) continue;
      const m = stammdatenFeldPruefen(f, neu);
      if (m) fehler[f] = m; else werte[f] = neu;
    }
    if (!e.gueltig_ab.value) fehler.gueltig_ab = "Bitte angeben, ab wann die Änderung gilt.";
    if (!e.grund.value.trim()) fehler.grund = "Bitte einen Grund angeben.";
    form.querySelectorAll("[data-fehler]").forEach((el) => {
      el.textContent = fehler[el.dataset.fehler] || "";
      e[el.dataset.fehler]?.setAttribute("aria-invalid", fehler[el.dataset.fehler] ? "true" : "false");
    });
    const meldung = form.querySelector(".fehler");
    meldung.textContent = "";
    if (Object.keys(fehler).length) return;
    if (!Object.keys(werte).length) { meldung.textContent = "Bitte mindestens ein Feld ändern."; return; }

    const knopf = form.querySelector("button[type=submit]");
    knopf.disabled = true;
    try {
      const dokumentId = await api.funktion("stammdaten_aendern", { p_mitarbeiter_id: kopf.mitarbeiter_id,
        p_werte: werte, p_gueltig_ab: e.gueltig_ab.value, p_grund: e.grund.value.trim() });
      gespeichert(bereich, stufe, dokumentId, Object.keys(werte), kopf, stand, fertig);
    } catch (f) {
      meldung.textContent = f.message;
      knopf.disabled = false;
    }
  });
}

// Nach dem Speichern: Nachweis gleich hochladen oder später (dann steht „Nachweis fehlt“ in den offenen Punkten)
function gespeichert(bereich, stufe, dokumentId, felder, kopf, stand, fertig) {
  bereich.innerHTML = `
    <div class="dialog" role="status">
      <h3>Gespeichert: ${text(felder.map((f) => NAME[f]).join(", "))}</h3>
      <p>Bitte jetzt den Nachweis hochladen. Bis dahin steht die Änderung bei den offenen Punkten.</p>
      <div class="knopf-reihe">
        <button type="button" class="knopf knopf-haupt" data-aktion="nachweis">Nachweis hochladen</button>
        <button type="button" class="knopf knopf-leise" data-aktion="spaeter">Später</button>
      </div>
    </div>`;
  bereich.querySelector("[data-aktion=spaeter]").addEventListener("click", () => fertig());
  bereich.querySelector("[data-aktion=nachweis]").addEventListener("click", () =>
    hochladenDialog(bereich, { kategorie: `nachweis_${stufe}`, bezeichnung: "Nachweis Stammdatenänderung", dokumentId },
      kopf, stand, fertig));
}

function svDialog(bereich, kopf, fertig) {
  bereich.innerHTML = `
    <form class="dialog" id="sv-form" novalidate>
      <h3>Versicherungsnummer eintragen</h3>
      <label class="feld schmal"><span>Versicherungsnummer</span><input type="text" name="sv_nummer" inputmode="numeric" maxlength="12"></label>
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">Eintragen</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#sv-form");
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nr = normalisiert("sv_nummer", form.elements.sv_nummer.value);
    const m = stammdatenFeldPruefen("sv_nummer", nr);
    if (m) { form.querySelector(".fehler").textContent = m; return; }
    try {
      await api.funktion("sv_nummer_nachtragen", { p_mitarbeiter_id: kopf.mitarbeiter_id, p_sv_nummer: nr });
      bereich.innerHTML = "";
      await fertig();
    } catch (f) {
      form.querySelector(".fehler").textContent = f.message;
    }
  });
}
