// Einstellungen-Seite: Rechte je Rolle, Funktionen, Regeln für Dienstverträge.
// Jede Änderung wird sofort gespeichert. Ob sie erlaubt ist, entscheidet die
// Datenbank; diese Seite zeigt nur das Ergebnis an.
import * as api from "./api.js";
import { austrittsartenVergessen } from "./akte_austritt.js";

const $ = (sel) => document.querySelector(sel);

const STUFEN = ["sieht_kontakt", "sieht_personendaten", "sieht_entgelt", "sieht_lohnverrechnung", "sieht_dokumente"];
const STUFEN_NAMEN = {
  sieht_kontakt: "Kontakt", sieht_personendaten: "Personendaten", sieht_entgelt: "Entgelt",
  sieht_lohnverrechnung: "Lohnverrechnung", sieht_dokumente: "Dokumente",
};
const REIHENFOLGE = ["admin", "geschaeftsfuehrung", "hr", "buchhaltung", "verwaltung",
  "regionalleitung", "studioleitung", "mitarbeiter"];
const REICHWEITE = { alle: "Alle Standorte", zugeordnet: "Nur zugeordnete", eigene: "Nur eigene Daten" };

let stand;
let neuLaden;
let eingerichtet = false;

export function einstellungenZeigen(s, nachAenderung) {
  stand = s;
  neuLaden = nachAenderung;
  const verwalten = Boolean(stand.recht.darf_verwalten);
  // Wer nur das Analyse-Recht vergibt (z. B. Geschäftsführung ohne „verwalten“), sieht nur diesen Teil
  document.querySelectorAll("#seite-einstellungen .einstellung").forEach((el) => {
    el.hidden = el.id === "einstellung-analyse" ? !stand.recht.vergibt_analyse_export : !verwalten;
  });
  if (!eingerichtet) {
    $("#analyse-rechte").addEventListener("change", analyseRechtSetzen);
    $("#rechte").addEventListener("change", rechtAendern);
    $("#funktionen").addEventListener("change", funktionAendern);
    $("#regeln").addEventListener("submit", regelnSpeichern);
    $("#onboarding-einstellungen").addEventListener("change", onboardingAendern);
    $("#onboarding-neu").addEventListener("submit", onboardingAnlegen);
    $("#onboarding-einstellungen").addEventListener("click", (e) => {
      const k = e.target.closest("[data-text]");
      if (!k) return;
      const zeile = document.querySelector(`[data-text-zeile="${k.dataset.text}"]`);
      zeile.hidden = !zeile.hidden;
      k.setAttribute("aria-expanded", String(!zeile.hidden));
      if (!zeile.hidden) zeile.querySelector("textarea").focus();
    });
    $("#textbausteine").addEventListener("change", bausteinAendern);
    $("#textbausteine").addEventListener("click", bausteinAbweichend);
    $("#textbaustein-gmbh").addEventListener("change", bausteineZeichnen);
    $("#textbaustein-neu").addEventListener("submit", bausteinAnlegen);
    $("#austritt-regeln").addEventListener("submit", austrittRegelnSpeichern);
    $("#lohnverrechner-einstellungen").addEventListener("change", lohnverrechnerAendern);
    $("#austrittsarten-einstellungen").addEventListener("change", austrittsartAendern);
    $("#austrittsart-neu").addEventListener("submit", austrittsartAnlegen);
    eingerichtet = true;
  }
  analyseRechteZeichnen();
  if (!verwalten) return;
  zeichnen();
  onboardingLaden();
  bausteineLaden();
  austrittLaden();
}

// ---------------------------------------------------------------- Austritt: Abmeldefrist, Mail-Adressen, Austrittsarten
export const mailGueltig = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
const MAIL_FEHLER = "Bitte eine gültige E-Mail-Adresse eingeben.";
let lohnverrechner = [];
let austrittsarten = [];

async function austrittLaden() {
  const f = $("#austritt-regeln").elements;
  f.abmeldefrist_tage.value = stand.organisation.abmeldefrist_tage ?? 7;
  f.buero_email.value = stand.organisation.buero_email || "";
  try {
    [lohnverrechner, austrittsarten] = await Promise.all([
      api.lesen("lohnverrechner", "select=id,name,email&order=name"),
      api.lesen("austrittsart", "select=*&order=reihenfolge,bezeichnung"),
    ]);
  } catch (e) {
    meldung(`Austritt-Einstellungen nicht geladen: ${e.message}`, true);
  }
  $("#lohnverrechner-einstellungen").innerHTML = lohnverrechner.map((l) => `<tr><th scope="row">${text(l.name)}</th>
    <td><input type="email" data-id="${text(l.id)}" value="${text(l.email || "")}" maxlength="200" aria-label="${text(l.name)}: E-Mail"></td></tr>`).join("")
    || '<tr><td colspan="2">Noch keine Lohnverrechner hinterlegt.</td></tr>';
  $("#austrittsarten-einstellungen").innerHTML = austrittsarten.map((a) => `<tr${a.aktiv ? "" : ' class="inaktiv"'}>
    <th scope="row"><input type="text" data-id="${text(a.id)}" data-feld="bezeichnung" value="${text(a.bezeichnung)}" maxlength="120" aria-label="Bezeichnung"></th>
    <td><input type="number" data-id="${text(a.id)}" data-feld="reihenfolge" value="${text(a.reihenfolge)}" min="0" step="1" aria-label="${text(a.bezeichnung)}: Reihenfolge"></td>
    <td><input type="checkbox" data-id="${text(a.id)}" data-feld="aktiv"${a.aktiv ? " checked" : ""} aria-label="${text(a.bezeichnung)}: aktiv"></td></tr>`).join("");
}

async function austrittRegelnSpeichern(e) {
  e.preventDefault();
  const f = e.target.elements;
  const tage = Number(f.abmeldefrist_tage.value);
  const mail = f.buero_email.value.trim();
  if (!Number.isInteger(tage) || tage < 1 || tage > 30 || f.abmeldefrist_tage.value === "") return meldung("Bitte 1 bis 30 Tage eingeben.", true);
  if (mail && !mailGueltig(mail)) return meldung(MAIL_FEHLER, true);
  try {
    await api.aendern("organisation", `id=eq.${stand.organisation.id}`, { abmeldefrist_tage: tage, buero_email: mail || null });
    await neuLaden();
    meldung("Austritt-Einstellungen gespeichert.");
  } catch (fehler) {
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  }
  austrittLaden();
}

async function lohnverrechnerAendern(e) {
  const l = lohnverrechner.find((x) => x.id === e.target.dataset.id);
  if (!l) return;
  const mail = e.target.value.trim();
  if (mail && !mailGueltig(mail)) return meldung(MAIL_FEHLER, true);
  try {
    await api.aendern("lohnverrechner", `id=eq.${l.id}`, { email: mail || null });
    meldung(`Gespeichert: ${l.name}.`);
  } catch (fehler) {
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  }
  austrittLaden();
}

async function austrittsartAendern(e) {
  const el = e.target;
  const a = austrittsarten.find((x) => x.id === el.dataset.id);
  if (!a) return;
  let wert = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.feld === "reihenfolge") wert = Number(wert);
  if (el.dataset.feld === "bezeichnung" && !String(wert).trim()) { meldung("Die Bezeichnung darf nicht leer sein.", true); return austrittLaden(); }
  try {
    await api.aendern("austrittsart", `id=eq.${a.id}`, { [el.dataset.feld]: el.dataset.feld === "bezeichnung" ? String(wert).trim() : wert });
    austrittsartenVergessen();
    meldung(`Gespeichert: ${el.dataset.feld === "bezeichnung" ? String(wert).trim() : a.bezeichnung}.`);
  } catch (fehler) {
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  }
  austrittLaden();
}

async function austrittsartAnlegen(e) {
  e.preventDefault();
  const f = e.target.elements;
  const bezeichnung = f.bezeichnung.value.trim();
  if (!bezeichnung) return;
  let schluessel = schluesselAus(bezeichnung);
  while (austrittsarten.some((a) => a.schluessel === schluessel)) schluessel += "_neu";
  const reihenfolge = Math.max(0, ...austrittsarten.map((a) => Number(a.reihenfolge) || 0)) + 1;
  try {
    await api.anlegen("austrittsart", { organisation_id: stand.organisation.id, schluessel, bezeichnung, reihenfolge, aktiv: true });
    austrittsartenVergessen();
    meldung(`Hinzugefügt: ${bezeichnung}.`);
    e.target.reset();
  } catch (fehler) {
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  }
  austrittLaden();
}

// ---------------------------------------------------------------- Recht „Analyse herunterladen“
// Nur über public.analyse_recht_setzen (prüft, ob man vergeben darf, und protokolliert jede Änderung).
// Mitarbeiter mit Reichweite „eigene“ sehen ohnehin nur sich selbst; für sie ist die Analyse sinnlos.
function analyseRechteZeichnen() {
  if (!stand.recht.vergibt_analyse_export) return;
  $("#analyse-rechte").innerHTML = (stand.rechte || [])
    .filter((r) => r.reichweite !== "eigene")
    .sort((a, b) => REIHENFOLGE.indexOf(a.rolle) - REIHENFOLGE.indexOf(b.rolle))
    .map((r) => `<li><label class="ankreuzen"><input type="checkbox" data-analyse-recht="${text(r.rolle)}"${r.darf_analyse_export ? " checked" : ""}>
      ${text(r.bezeichnung || r.rolle)}</label></li>`).join("");
}

async function analyseRechtSetzen(e) {
  const feld = e.target;
  const rolle = stand.rechte.find((r) => r.rolle === feld.dataset.analyseRecht);
  if (!rolle) return;
  const darf = feld.checked;
  feld.disabled = true;
  try {
    await api.funktion("analyse_recht_setzen", { p_rolle: rolle.rolle, p_darf: darf });
    rolle.darf_analyse_export = darf;
    if (rolle.rolle === stand.profil.rolle) stand.recht.darf_analyse_export = darf;
    meldung(`Gespeichert: ${rolle.bezeichnung || rolle.rolle} ${darf ? "darf" : "darf nicht mehr"} die Analyse herunterladen.`);
  } catch (fehler) {
    feld.checked = !darf;
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  } finally {
    feld.disabled = false;
  }
}

// ---------------------------------------------------------------- Textbausteine für den Dienstzettel
let bausteine = [];

async function bausteineLaden() {
  const auswahl = $("#textbaustein-gmbh");
  if (!auswahl.options.length) {
    auswahl.innerHTML = '<option value="">Alle GmbHs</option>' + [...stand.gesellschaften.values()]
      .map((g) => `<option value="${text(g.id)}">${text(g.name)}</option>`).join("");
  }
  try {
    bausteine = await api.lesen("textbaustein", "select=*&order=reihenfolge,titel");
  } catch (e) {
    meldung(`Textbausteine nicht geladen: ${e.message}`, true);
    bausteine = [];
  }
  bausteineZeichnen();
}

function bausteinFelder(b, hinweis = "") {
  return `<div class="baustein${b.aktiv ? "" : " inaktiv"}">
    <div class="reihe">
      <label class="feld"><span>Titel</span><input data-id="${b.id}" data-feld="titel" value="${text(b.titel)}" maxlength="80"></label>
      <label class="feld schmal"><span>Reihenfolge</span><input type="number" data-id="${b.id}" data-feld="reihenfolge" value="${text(b.reihenfolge)}" min="0" step="1"></label>
      <label class="ankreuzen"><input type="checkbox" data-id="${b.id}" data-feld="aktiv"${b.aktiv ? " checked" : ""}> aktiv</label>
    </div>
    <label class="feld"><span>Text${hinweis}</span><textarea data-id="${b.id}" data-feld="text" rows="3">${text(b.text)}</textarea></label>
  </div>`;
}

function bausteineZeichnen() {
  const gmbh = $("#textbaustein-gmbh").value;
  const alle = bausteine.filter((b) => !b.gesellschaft_id);
  $("#textbaustein-neu").hidden = Boolean(gmbh);
  if (!gmbh) {
    $("#textbausteine").innerHTML = alle.map((b) => bausteinFelder(b)).join("") || '<p class="leer-zustand">Noch keine Textbausteine.</p>';
    return;
  }
  const name = stand.gesellschaften.get(gmbh)?.name || "diese GmbH";
  $("#textbausteine").innerHTML = alle.map((b) => {
    const eigen = bausteine.find((x) => x.gesellschaft_id === gmbh && x.schluessel === b.schluessel);
    if (eigen) return bausteinFelder(eigen, ` (nur ${text(name)})`);
    return `<div class="baustein geerbt"><p><strong>${text(b.titel)}</strong> – gilt wie für alle GmbHs.</p>
      <p class="einleitung klein">${text(b.text)}</p>
      <button type="button" class="knopf knopf-leise" data-abweichend="${text(b.schluessel)}">Für ${text(name)} abweichend festlegen</button></div>`;
  }).join("");
}

async function bausteinAendern(e) {
  const el = e.target;
  const b = bausteine.find((x) => x.id === el.dataset.id);
  if (!b) return;
  let wert = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.feld === "reihenfolge") wert = Number(wert);
  if (el.dataset.feld === "titel" && !String(wert).trim()) { meldung("Der Titel darf nicht leer sein.", true); return bausteineZeichnen(); }
  try {
    await api.aendern("textbaustein", `id=eq.${b.id}`, { [el.dataset.feld]: wert });
    meldung(`Gespeichert: ${b.titel}.`);
  } catch (f) {
    meldung(`Nicht gespeichert: ${f.message}`, true);
  }
  await bausteineLaden();
}

async function bausteinAbweichend(e) {
  const k = e.target.closest("[data-abweichend]");
  if (!k) return;
  const gmbh = $("#textbaustein-gmbh").value;
  const vorlage = bausteine.find((b) => !b.gesellschaft_id && b.schluessel === k.dataset.abweichend);
  try {
    await api.anlegen("textbaustein", { organisation_id: stand.organisation.id, gesellschaft_id: gmbh, schluessel: vorlage.schluessel,
      titel: vorlage.titel, text: vorlage.text, reihenfolge: vorlage.reihenfolge });
    meldung(`Eigene Fassung angelegt: ${vorlage.titel}. Jetzt den Text anpassen.`);
  } catch (f) {
    meldung(`Nicht gespeichert: ${f.message}`, true);
  }
  await bausteineLaden();
}

// „Dienstort & Wechsel“ → „dienstort_wechsel“
export function schluesselAus(titel) {
  return titel.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "") || "abschnitt";
}

async function bausteinAnlegen(e) {
  e.preventDefault();
  const f = e.target.elements;
  const titel = f.titel.value.trim();
  if (!titel) return;
  let schluessel = schluesselAus(titel);
  while (bausteine.some((b) => !b.gesellschaft_id && b.schluessel === schluessel)) schluessel += "_neu";
  const reihenfolge = Math.max(0, ...bausteine.map((b) => Number(b.reihenfolge) || 0)) + 1;
  try {
    await api.anlegen("textbaustein", { organisation_id: stand.organisation.id, gesellschaft_id: null, schluessel, titel,
      text: f.text.value.trim(), reihenfolge });
    meldung(`Hinzugefügt: ${titel}.`);
    e.target.reset();
  } catch (fehler) {
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  }
  await bausteineLaden();
}

// ---------------------------------------------------------------- Onboarding-Unterlagen
const GILT = { beide: "Studio und Büro", studio: "nur Studio", buero: "nur Büro" };
let unterlagen = [];

async function onboardingLaden() {
  try {
    unterlagen = await api.lesen("onboarding_unterlage", "select=*&order=reihenfolge,bezeichnung");
  } catch (e) {
    meldung(`Onboarding-Unterlagen nicht geladen: ${e.message}`, true);
    unterlagen = [];
  }
  onboardingZeichnen();
}

function onboardingZeichnen() {
  $("#onboarding-einstellungen").innerHTML = unterlagen.map((u) => `<tr${u.aktiv ? "" : ' class="inaktiv"'}>
    <th scope="row"><input type="text" data-id="${u.id}" data-feld="bezeichnung" value="${text(u.bezeichnung)}"
      aria-label="Bezeichnung" maxlength="120"></th>
    <td><input type="number" data-id="${u.id}" data-feld="reihenfolge" value="${text(u.reihenfolge)}" min="0" step="1"
      aria-label="${text(u.bezeichnung)}: Reihenfolge"></td>
    <td><input type="checkbox" data-id="${u.id}" data-feld="pflicht"${u.pflicht ? " checked" : ""}
      aria-label="${text(u.bezeichnung)}: Pflicht"></td>
    <td><select data-id="${u.id}" data-feld="gilt_fuer" aria-label="${text(u.bezeichnung)}: gilt für">${Object.entries(GILT).map(([w, t]) =>
      `<option value="${w}"${u.gilt_fuer === w ? " selected" : ""}>${t}</option>`).join("")}</select></td>
    <td><input type="checkbox" data-id="${u.id}" data-feld="aktiv"${u.aktiv ? " checked" : ""}
      aria-label="${text(u.bezeichnung)}: aktiv"></td>
    <td><button type="button" class="knopf knopf-leise" data-text="${u.id}" aria-expanded="false">${u.text ? "Text bearbeiten" : "Text fehlt"}</button></td>
  </tr>
  <tr class="text-zeile" data-text-zeile="${u.id}" hidden><td colspan="6">
    <label class="feld"><span>Text, den der Mitarbeiter in der Unterschriftsmappe liest</span>
      <textarea data-id="${u.id}" data-feld="text" rows="4">${text(u.text || "")}</textarea></label></td></tr>`).join("")
    || '<tr><td colspan="6">Noch keine Unterlagen.</td></tr>';
}

async function onboardingAendern(e) {
  const el = e.target;
  const u = unterlagen.find((x) => x.id === el.dataset.id);
  if (!u) return;
  let wert = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.feld === "reihenfolge") wert = Number(wert);
  if (el.dataset.feld === "bezeichnung" && !String(wert).trim()) { meldung("Die Bezeichnung darf nicht leer sein.", true); return onboardingZeichnen(); }
  try {
    await api.aendern("onboarding_unterlage", `id=eq.${u.id}`, { [el.dataset.feld]: wert });
    meldung(`Gespeichert: ${u.bezeichnung}.`);
  } catch (f) {
    meldung(`Nicht gespeichert: ${f.message}`, true);
  }
  await onboardingLaden();
}

async function onboardingAnlegen(e) {
  e.preventDefault();
  const f = e.target.elements;
  const bezeichnung = f.bezeichnung.value.trim();
  if (!bezeichnung) return;
  const reihenfolge = Math.max(0, ...unterlagen.map((u) => Number(u.reihenfolge) || 0)) + 1;
  try {
    await api.anlegen("onboarding_unterlage", { organisation_id: stand.organisation.id, bezeichnung, reihenfolge,
      pflicht: f.pflicht.checked, gilt_fuer: f.gilt_fuer.value });
    meldung(`Hinzugefügt: ${bezeichnung}.`);
    e.target.reset();
  } catch (fehler) {
    meldung(`Nicht gespeichert: ${fehler.message}`, true);
  }
  await onboardingLaden();
}

function zeichnen() {
  const rechte = [...stand.rechte].sort((a, b) => REIHENFOLGE.indexOf(a.rolle) - REIHENFOLGE.indexOf(b.rolle));
  $("#rechte").innerHTML = rechte.map((r) => {
    const gesperrt = r.rolle === "admin" ? " disabled" : "";
    const kaestchen = STUFEN.map((k) => `<td><input type="checkbox" data-rolle="${r.rolle}" data-feld="${k}"
        aria-label="${text(r.bezeichnung)}: ${STUFEN_NAMEN[k]}"${r[k] ? " checked" : ""}${gesperrt}></td>`).join("");
    const reichweite = `<select data-rolle="${r.rolle}" data-feld="reichweite" aria-label="${text(r.bezeichnung)}: Standorte"${gesperrt}>
        ${Object.entries(REICHWEITE).map(([w, t]) => `<option value="${w}"${r.reichweite === w ? " selected" : ""}>${t}</option>`).join("")}
      </select>`;
    return `<tr>
      <th scope="row">${text(r.bezeichnung)}</th>
      ${kaestchen}
      <td>${reichweite}</td>
      <td><input type="checkbox" data-rolle="${r.rolle}" data-feld="darf_anlegen"
        aria-label="${text(r.bezeichnung)}: darf anlegen"${r.darf_anlegen ? " checked" : ""}${gesperrt}></td>
      <td><input type="checkbox" data-rolle="${r.rolle}" data-feld="darf_arbeitgeber_unterschreiben"
        aria-label="${text(r.bezeichnung)}: Arbeitgeber-Unterschrift"${r.darf_arbeitgeber_unterschreiben ? " checked" : ""}${gesperrt}></td>
    </tr>`;
  }).join("");

  $("#funktionen").innerHTML = stand.funktionen.map((f) => {
    const buero = f.bereich === "buero";
    const darf = (rolle) => (f.anlegen_durch || []).includes(rolle);
    return `<tr>
      <th scope="row">${text(f.name)}</th>
      <td>${buero ? "Büro" : "Studio"}</td>
      <td><input type="checkbox" data-id="${f.id}" data-rolle="studioleitung"
        aria-label="${text(f.name)}: Studioleitung darf anlegen"${darf("studioleitung") ? " checked" : ""}${buero ? " disabled" : ""}></td>
      <td><input type="checkbox" data-id="${f.id}" data-rolle="regionalleitung"
        aria-label="${text(f.name)}: Regionalleitung darf anlegen"${darf("regionalleitung") ? " checked" : ""}${buero ? " disabled" : ""}></td>
      <td><input type="checkbox" data-id="${f.id}" data-feld="leiterzulage_moeglich"
        aria-label="${text(f.name)}: Leiterzulage möglich"${f.leiterzulage_moeglich ? " checked" : ""}></td>
    </tr>`;
  }).join("");

  const regeln = $("#regeln").elements;
  for (const name of ["vollzeit_stunden", "max_stunden_tag", "geringfuegig_grenze", "probezeit_monate", "befristung_monate",
    "tage_dazwischen_vor", "tage_dazwischen_nach"]) {
    regeln[name].value = stand.organisation[name] ?? "";
  }
  regeln.anmeldung_stichzeit.value = String(stand.organisation.anmeldung_stichzeit || "12:00").slice(0, 5);
}

function meldung(textInhalt, fehler = false) {
  const el = $("#einstellungen-status");
  el.textContent = textInhalt;
  el.classList.toggle("fehler", fehler);
}

async function speichernUnd(aktion, erfolg) {
  try {
    await aktion();
    await neuLaden();
    meldung(erfolg);
  } catch (e) {
    meldung(`Nicht gespeichert: ${e.message}`, true);
  }
  zeichnen();
}

async function rechtAendern(e) {
  const el = e.target;
  const wert = el.type === "checkbox" ? el.checked : el.value;
  const rolle = stand.rechte.find((r) => r.rolle === el.dataset.rolle);
  await speichernUnd(
    () => api.aendern("rollen_recht",
      `organisation_id=eq.${stand.organisation.id}&rolle=eq.${encodeURIComponent(el.dataset.rolle)}`,
      { [el.dataset.feld]: wert }),
    `Gespeichert: ${rolle.bezeichnung}.`);
}

async function funktionAendern(e) {
  const el = e.target;
  const f = stand.funktionen.find((x) => x.id === el.dataset.id);
  let werte;
  if (el.dataset.feld) {
    werte = { [el.dataset.feld]: el.checked };
  } else {
    const menge = new Set(f.anlegen_durch || []);
    if (el.checked) menge.add(el.dataset.rolle); else menge.delete(el.dataset.rolle);
    werte = { anlegen_durch: [...menge] };
  }
  await speichernUnd(() => api.aendern("funktion", `id=eq.${f.id}`, werte), `Gespeichert: ${f.name}.`);
}

async function regelnSpeichern(e) {
  e.preventDefault();
  const r = e.target.elements;
  const zahl = (n) => (r[n].value === "" ? null : Number(r[n].value));
  await speichernUnd(() => api.aendern("organisation", `id=eq.${stand.organisation.id}`, {
    vollzeit_stunden: zahl("vollzeit_stunden"),
    max_stunden_tag: zahl("max_stunden_tag"),
    geringfuegig_grenze: zahl("geringfuegig_grenze"),
    probezeit_monate: zahl("probezeit_monate"),
    befristung_monate: zahl("befristung_monate"),
    anmeldung_stichzeit: r.anmeldung_stichzeit.value || "12:00",
    tage_dazwischen_vor: zahl("tage_dazwischen_vor"),
    tage_dazwischen_nach: zahl("tage_dazwischen_nach"),
  }), "Regeln gespeichert.");
}

function text(wert) {
  return String(wert ?? "").replace(/[&<>"']/g, (z) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[z]);
}
