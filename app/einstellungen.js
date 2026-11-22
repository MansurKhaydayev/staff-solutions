// Einstellungen-Seite: Rechte je Rolle, Funktionen, Regeln für Dienstverträge.
// Jede Änderung wird sofort gespeichert. Ob sie erlaubt ist, entscheidet die
// Datenbank; diese Seite zeigt nur das Ergebnis an.
import * as api from "./api.js";

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
  if (!eingerichtet) {
    $("#rechte").addEventListener("change", rechtAendern);
    $("#funktionen").addEventListener("change", funktionAendern);
    $("#regeln").addEventListener("submit", regelnSpeichern);
    $("#onboarding-einstellungen").addEventListener("change", onboardingAendern);
    $("#onboarding-neu").addEventListener("submit", onboardingAnlegen);
    eingerichtet = true;
  }
  zeichnen();
  onboardingLaden();
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
  </tr>`).join("") || '<tr><td colspan="5">Noch keine Unterlagen.</td></tr>';
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
  for (const name of ["vollzeit_stunden", "max_stunden_tag", "geringfuegig_grenze", "probezeit_monate", "befristung_monate"]) {
    regeln[name].value = stand.organisation[name] ?? "";
  }
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
  }), "Regeln gespeichert.");
}

function text(wert) {
  return String(wert ?? "").replace(/[&<>"']/g, (z) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[z]);
}
