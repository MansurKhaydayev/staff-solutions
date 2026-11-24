import * as api from "./api.js";
import { fristende, datumAT, euro } from "./fristen.js";
import { dienstzettelPruefen, heuteIso } from "./pruefungen.js";
import { einstellungenZeigen } from "./einstellungen.js";
import { akteZeigen, akteVergessen } from "./akte.js";
import { offenePunkteZeigen } from "./offene_punkte.js";
import { mappeZeigen } from "./mappe.js";
import { arbeitgeberZeigen } from "./arbeitgeber.js";

const $ = (sel) => document.querySelector(sel);

// Daten, die beim Start geladen werden
const stand = {
  profil: null,
  organisation: null,
  standorte: [],          // alle sichtbaren Standorte
  erfassbareStandorte: [],// wo diese Person Mitarbeiter anlegen darf
  gesellschaften: new Map(),
  tarifzonen: new Map(),
  funktionen: [],         // alle
  erfassbareFunktionen: [],
  bruttoTabelle: [],      // nur für das Büro sichtbar
  liste: [],              // Mitarbeiterliste (geladen)
};

const BUERO = ["admin", "geschaeftsfuehrung", "hr"];
const LEITUNG = ["studioleitung", "regionalleitung"];
const istBuero = () => BUERO.includes(stand.profil?.rolle);

// Felder, die der Nutzer schon verlassen hat: nur dort zeigen wir Fehler sofort
const beruehrt = new Set();
let absendenVersucht = false;

// ------------------------------------------------------------------ Start

document.addEventListener("DOMContentLoaded", () => {
  $("#anmelde-formular").addEventListener("submit", anmelden);
  $("#abmelden").addEventListener("click", abmelden);

  const form = $("#dienstzettel");
  form.addEventListener("input", aktualisieren);
  form.addEventListener("change", (e) => {
    beruehrt.add(e.target.name);
    if (e.target.name === "funktion") standorteFuellen();
    aktualisieren();
  });
  form.addEventListener("focusout", (e) => {
    if (e.target.name) beruehrt.add(e.target.name);
    aktualisieren();
  });
  form.addEventListener("submit", speichern);
  $("#naechster").addEventListener("click", neuesFormular);

  const filter = $("#filter");
  filter.addEventListener("submit", (e) => e.preventDefault());
  filter.addEventListener("input", listeZeigen);
  filter.addEventListener("change", listeZeigen);

  window.addEventListener("hashchange", seiteZeigen);
  start();
});

async function start() {
  if (!api.angemeldet()) return ansicht("anmeldung");
  try {
    await stammdatenLaden();
    ansicht("programm");
    seiteZeigen();
  } catch (fehler) {
    if (fehler.status === 401) return ansicht("anmeldung");
    zeigeAnmeldeFehler(fehler.message);
    ansicht("anmeldung");
  }
}

function ansicht(name) {
  $("#ansicht-anmeldung").hidden = name !== "anmeldung";
  $("#ansicht-programm").hidden = name !== "programm";
}

// ------------------------------------------------------------------ Anmeldung

async function anmelden(ereignis) {
  ereignis.preventDefault();
  const daten = new FormData(ereignis.target);
  const knopf = ereignis.target.querySelector("button");
  $("#anmelde-fehler").hidden = true;
  knopf.disabled = true;
  try {
    await api.anmelden(String(daten.get("email")).trim(), daten.get("passwort"));
    await start();
  } catch (fehler) {
    zeigeAnmeldeFehler(fehler.status === 400
      ? "E-Mail oder Passwort stimmen nicht."
      : `Anmeldung nicht möglich: ${fehler.message}`);
  } finally {
    knopf.disabled = false;
  }
}

function zeigeAnmeldeFehler(text) {
  const el = $("#anmelde-fehler");
  el.textContent = text;
  el.hidden = false;
}

async function abmelden() {
  await api.abmelden().catch(() => {});
  location.hash = "";
  ansicht("anmeldung");
}

// ------------------------------------------------------------------ Stammdaten

async function stammdatenLaden() {
  const user = api.benutzer();
  const profile = await api.lesen("profil", `select=*&user_id=eq.${user.id}`);
  if (!profile.length) {
    throw new api.ApiFehler("Dein Zugang ist noch keiner Firma zugeordnet. Bitte das Personalbüro, dir eine Rolle zu geben.", 403);
  }
  stand.profil = profile[0];
  const leitung = LEITUNG.includes(stand.profil.rolle);

  // Rechte der eigenen Rolle (und aller Rollen, für die Einstellungen)
  stand.rechte = await api.lesen("rollen_recht", "select=*");
  stand.recht = stand.rechte.find((r) => r.rolle === stand.profil.rolle) || {};

  const [orgs, standorte, gesellschaften, zonen, funktionen, brutto, zust] = await Promise.all([
    api.lesen("organisation", "select=id,name,probezeit_monate,befristung_monate,vollzeit_stunden,geringfuegig_grenze,max_stunden_tag," +
      "anmeldung_stichzeit,tage_dazwischen_vor,tage_dazwischen_nach"),
    api.lesen("standort", "select=id,name,art,vertragsbezeichnung,gesellschaft_id,tarifzone_id&order=name"),
    api.lesen("gesellschaft", "select=id,name,strasse,plz,ort"),
    api.lesen("tarifzone", "select=id,name"),
    api.lesen("funktion", "select=id,name,bereich,anlegen_durch,leiterzulage_moeglich&order=name"),
    stand.recht.sieht_entgelt ? api.lesen("brutto_tabelle", "select=tarifzone_id,netto,brutto,gueltig_ab&order=gueltig_ab.desc")
               : Promise.resolve([]),
    leitung ? api.lesen("zustaendigkeit", "select=standort_id") : Promise.resolve(null),
  ]);

  stand.organisation = orgs[0];
  stand.gesellschaften = new Map(gesellschaften.map((g) => [g.id, g]));
  stand.tarifzonen = new Map(zonen.map((z) => [z.id, z]));
  stand.funktionen = funktionen;
  stand.standorte = standorte;
  stand.bruttoTabelle = brutto;

  if (!stand.recht.darf_anlegen) {
    stand.erfassbareStandorte = [];
    stand.erfassbareFunktionen = [];
  } else if (istBuero()) {
    stand.erfassbareStandorte = standorte;
    stand.erfassbareFunktionen = funktionen;
  } else if (leitung) {
    const meine = new Set(zust.map((z) => z.standort_id));
    stand.erfassbareStandorte = standorte.filter((s) => meine.has(s.id) && s.art === "studio");
    stand.erfassbareFunktionen = funktionen.filter((f) => (f.anlegen_durch || []).includes(stand.profil.rolle));
  } else {
    stand.erfassbareStandorte = [];
    stand.erfassbareFunktionen = [];
  }

  $("#wer").textContent = `${user.email}, ${rolleText(stand.profil.rolle)}`;
  const darfErfassen = stand.erfassbareFunktionen.length > 0;
  document.querySelector('[data-ziel="erfassen"]').hidden = !darfErfassen;
  document.querySelector('[data-ziel="einstellungen"]').hidden = !stand.recht.darf_verwalten;
  document.querySelector('[data-ziel="offen"]').hidden = !darfOffenePunkte();
  document.querySelector('[data-ziel="unterschreiben"]').hidden = !stand.recht.darf_arbeitgeber_unterschreiben;
  $('#filter option[value="befristung"]').hidden = !stand.recht.sieht_personendaten;

  funktionenFuellen();
  standorteFuellen();
  filterFuellen();
}

function rolleText(rolle) {
  return stand.rechte?.find((r) => r.rolle === rolle)?.bezeichnung || rolle;
}

function funktionenFuellen() {
  $('select[name="funktion"]').innerHTML = '<option value="">Bitte wählen</option>' +
    stand.erfassbareFunktionen.map((f) => `<option value="${f.id}">${text(f.name)}</option>`).join("");
}

// Arbeitsorte passend zur gewählten Funktion (Büro-Funktionen nur im Büro und umgekehrt)
function standorteFuellen() {
  const select = $('select[name="standort"]');
  const vorher = select.value;
  const funktion = stand.funktionen.find((f) => f.id === $('select[name="funktion"]').value);
  const passend = stand.erfassbareStandorte.filter((s) =>
    !funktion || (funktion.bereich === "buero" ? s.art === "buero" : s.art !== "buero"));
  select.innerHTML = `<option value="">${funktion ? "Bitte wählen" : "Zuerst Funktion wählen"}</option>` +
    passend.map((s) => `<option value="${s.id}">${text(s.vertragsbezeichnung || s.name)}</option>`).join("");
  if (passend.some((s) => s.id === vorher)) select.value = vorher;
  else if (passend.length === 1) select.value = passend[0].id;
  select.disabled = !funktion;
}

// ------------------------------------------------------------------ Seiten

const SEITEN = ["erfassen", "mitarbeiter", "offen", "unterschreiben", "akte", "mappe", "einstellungen"];
const darfOffenePunkte = () => istBuero() || LEITUNG.includes(stand.profil?.rolle);

function seiteZeigen() {
  const [teil, ...rest] = (location.hash.replace("#", "") || "erfassen").split("/");
  let ziel = teil;
  if (!SEITEN.includes(ziel)) ziel = "erfassen";
  if (ziel === "erfassen" && !stand.erfassbareFunktionen.length) ziel = "mitarbeiter";
  if (ziel === "einstellungen" && !stand.recht.darf_verwalten) ziel = "mitarbeiter";
  if ((ziel === "akte" || ziel === "mappe") && !rest[0]) ziel = "mitarbeiter";
  if (ziel === "offen" && !darfOffenePunkte()) ziel = "mitarbeiter";
  if (ziel === "unterschreiben" && !stand.recht.darf_arbeitgeber_unterschreiben) ziel = "mitarbeiter";
  for (const name of SEITEN) $(`#seite-${name}`).hidden = name !== ziel;
  // In der Akte bleibt "Mitarbeiter" in der Navigation markiert
  const navZiel = ziel === "akte" || ziel === "mappe" ? "mitarbeiter" : ziel;
  document.querySelectorAll(".navigation a").forEach((a) => {
    if (a.dataset.ziel === navZiel) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (ziel === "akte") akteZeigen(stand, rest[0], rest[1]);
  if (ziel === "mappe") mappeZeigen(stand, rest[0]);
  if (ziel === "unterschreiben") arbeitgeberZeigen(stand);
  if (ziel === "offen") offenePunkteZeigen(stand);
  if (ziel === "mitarbeiter") listeLaden();
  if (ziel === "einstellungen") einstellungenZeigen(stand, async () => { await stammdatenLaden(); });
}

// ------------------------------------------------------------------ Formular lesen und prüfen

function formWerte() {
  const f = $("#dienstzettel").elements;
  return {
    funktion: f.funktion.value, standort: f.standort.value,
    eintritt: f.eintritt.value, beschaeftigungsart: f.beschaeftigungsart.value,
    wochenstunden: f.wochenstunden.value, arbeitstage: f.arbeitstage.value,
    anrede: f.anrede.value, vorname: f.vorname.value, nachname: f.nachname.value,
    geburtsdatum: f.geburtsdatum.value, strasse: f.strasse.value, plz: f.plz.value, ort: f.ort.value,
    telefon: f.telefon.value, email: f.email.value, staatsangehoerigkeit: f.staatsangehoerigkeit.value,
    netto: f.netto.value, leiterzulage: $("#feld-zulage").hidden ? "" : f.leiterzulage.value,
    sonderzahlung: f.sonderzahlung.checked,
    svNummer: f.sv_nummer.value, svNachreichen: f.sv_nachreichen.checked,
    iban: f.iban.value, bic: f.bic.value,
    dringend: f.dringend.checked, dringendGrund: f.dringend_grund.value,
  };
}

function auswahl(w) {
  return {
    funktion: stand.funktionen.find((x) => x.id === w.funktion) || null,
    standort: stand.standorte.find((x) => x.id === w.standort) || null,
  };
}

// Fehlertext direkt unter dem Feld anzeigen oder entfernen
function feldMeldung(feld, meldung) {
  const label = feld.closest("label");
  if (!label) return;
  let el = label.querySelector(".feld-fehler");
  if (meldung) {
    if (!el) {
      el = document.createElement("small");
      el.className = "feld-fehler";
      el.id = `fehler-${feld.name}`;
      label.append(el);
    }
    el.textContent = meldung;
    feld.setAttribute("aria-invalid", "true");
    feld.setAttribute("aria-describedby", el.id);
  } else {
    el?.remove();
    feld.removeAttribute("aria-invalid");
    feld.removeAttribute("aria-describedby");
  }
}

function aktualisieren() {
  const form = $("#dienstzettel");
  const w = formWerte();
  const a = auswahl(w);

  $("#feld-zulage").hidden = !a.funktion?.leiterzulage_moeglich;
  form.elements.sv_nummer.disabled = w.svNachreichen;
  $("#dringend-grund-feld").hidden = !w.dringend;
  if (w.svNachreichen) form.elements.sv_nummer.value = "";

  const fehler = dienstzettelPruefen(w, stand.organisation, a);
  for (const feld of form.elements) {
    if (!feld.name || feld.type === "submit") continue;
    const zeigen = absendenVersucht || beruehrt.has(feld.name);
    feldMeldung(feld, zeigen ? fehler[feld.name] : null);
  }
  if (!Object.keys(fehler).length) $("#speicher-fehler").hidden = true;

  rechnungZeigen(w);
  vorschauZeigen(w, a);
  return fehler;
}

// Zeigt die Arbeitszeit als Rechnung, damit Unstimmigkeiten sofort auffallen
function rechnungZeigen(w) {
  const el = $("#rechnung-stunden");
  const stunden = Number(w.wochenstunden);
  const tage = Number(w.arbeitstage);
  if (stunden > 0 && tage >= 1) {
    const proTag = (stunden / tage).toLocaleString("de-DE", { maximumFractionDigits: 2 });
    el.textContent = `${stunden.toLocaleString("de-DE")} Stunden an ${tage} ${tage === 1 ? "Tag" : "Tagen"} ` +
      `= ${proTag} Stunden pro Arbeitstag`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// ------------------------------------------------------------------ Vorschau (markierte Spalte)

const markiert = (wert, zusatz = "") =>
  `<span class="wert">${text(wert)}</span>${zusatz ? `<small>${text(zusatz)}</small>` : ""}`;
const leer = (t) => `<span class="leer">${text(t)}</span>`;
const setze = (id, html) => { $(id).innerHTML = html; };

function vorschauZeigen(w, { standort, funktion }) {
  if (standort) {
    const g = stand.gesellschaften.get(standort.gesellschaft_id);
    setze("#a-gmbh", markiert(g.name, [g.strasse, [g.plz, g.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")));
    setze("#a-arbeitsort", markiert(standort.vertragsbezeichnung || standort.name));
  } else {
    setze("#a-gmbh", leer("Arbeitsort wählen"));
    setze("#a-arbeitsort", leer("Arbeitsort wählen"));
  }

  const monate = stand.organisation?.befristung_monate ?? 3;
  if (w.eintritt && monate > 0) {
    setze("#a-befristung", markiert(datumAT(fristende(w.eintritt, monate)), `${monate} Monate ab Dienstantritt`));
  } else {
    setze("#a-befristung", leer(w.eintritt ? "unbefristet" : "Dienstantritt eintragen"));
  }

  const netto = w.netto === "" ? null : Number(w.netto);
  if (!stand.recht.sieht_entgelt) {
    setze("#a-brutto", leer("ermittelt das Personalbüro"));
  } else if (netto === null || !standort || !w.eintritt) {
    setze("#a-brutto", leer("Arbeitsort, Dienstantritt und Netto eintragen"));
  } else {
    const treffer = stand.bruttoTabelle.find((b) =>
      b.tarifzone_id === standort.tarifzone_id && Number(b.netto) === netto && b.gueltig_ab <= w.eintritt);
    const zone = stand.tarifzonen.get(standort.tarifzone_id)?.name;
    setze("#a-brutto", treffer
      ? markiert(`€ ${euro(treffer.brutto)}`, `Brutto-Tabelle, Tarifzone ${zone}`)
      : leer(`Nicht in der Tabelle (Tarifzone ${zone}). Wird als offen markiert.`));
  }

  const vereinbarungen = [];
  if (w.sonderzahlung) vereinbarungen.push("Sonderzahlungen (13./14. Gehalt)");
  if (funktion?.leiterzulage_moeglich && Number(w.leiterzulage) > 0) {
    vereinbarungen.push(`Leiterzulage € ${euro(w.leiterzulage)} netto`);
  }
  setze("#a-vereinbarungen", vereinbarungen.length ? vereinbarungen.map((v) => markiert(v)).join("<br>") : leer("keine"));
}

// ------------------------------------------------------------------ Speichern

async function speichern(ereignis) {
  ereignis.preventDefault();
  absendenVersucht = true;
  const fehler = aktualisieren();
  const fehlerEl = $("#speicher-fehler");
  const anzahl = Object.keys(fehler).length;
  if (anzahl) {
    fehlerEl.textContent = anzahl === 1
      ? "1 Angabe fehlt oder stimmt nicht. Sie ist rot markiert."
      : `${anzahl} Angaben fehlen oder stimmen nicht. Sie sind rot markiert.`;
    fehlerEl.hidden = false;
    $('#dienstzettel [aria-invalid="true"]')?.focus();
    return;
  }

  const w = formWerte();
  const leerZuNull = (v) => (String(v).trim() === "" ? null : String(v).trim());
  const parameter = {
    p_standort_id: w.standort,
    p_funktion_id: w.funktion,
    p_vorname: w.vorname.trim(),
    p_nachname: w.nachname.trim(),
    p_eintritt: w.eintritt,
    p_beschaeftigungsart: w.beschaeftigungsart,
    p_wochenstunden: Number(w.wochenstunden),
    p_arbeitstage_woche: Number(w.arbeitstage),
    p_netto: Number(w.netto),
    p_anrede: w.anrede,
    p_geburtsdatum: w.geburtsdatum,
    p_strasse: w.strasse.trim(),
    p_plz: w.plz.trim(),
    p_ort: w.ort.trim(),
    p_telefon: w.telefon.trim(),
    p_email: w.email.trim(),
    p_staatsangehoerigkeit: w.staatsangehoerigkeit.trim(),
    p_iban: w.iban,
    p_sv_nummer: w.svNachreichen ? null : leerZuNull(w.svNummer),
    p_sv_nummer_nachreichen: w.svNachreichen,
    p_bic: leerZuNull(w.bic),
    p_sonderzahlung: w.sonderzahlung,
    p_leiterzulage_netto: leerZuNull(w.leiterzulage) === null ? null : Number(w.leiterzulage),
    p_dringend_grund: w.dringend ? leerZuNull(w.dringendGrund) : null,
  };

  const knopf = $("#speichern");
  knopf.disabled = true;
  knopf.textContent = "Wird gespeichert …";
  try {
    const dvId = await api.funktion("dienstzettel_erfassen", parameter);
    const [dv] = await api.lesen("dienstverhaeltnis", `select=befristet_bis&id=eq.${dvId}`);
    const studio = stand.standorte.find((s) => s.id === parameter.p_standort_id);
    $("#gespeichert-text").textContent =
      `${parameter.p_vorname} ${parameter.p_nachname} ist ab ${datumAT(parameter.p_eintritt)} ` +
      `in ${studio.vertragsbezeichnung || studio.name} angelegt.` +
      (dv?.befristet_bis ? ` Befristet bis ${datumAT(dv.befristet_bis)}.` : "") +
      (w.svNachreichen ? " Die Versicherungsnummer ist als offen vermerkt." : "");
    $("#mappe-oeffnen").href = `#mappe/${dvId}`;
    $("#dienstzettel").hidden = true;
    $("#gespeichert").hidden = false;
    $("#gespeichert").focus();
  } catch (fehler) {
    fehlerEl.textContent = `Nicht gespeichert: ${fehler.message}`;
    fehlerEl.hidden = false;
  } finally {
    knopf.disabled = false;
    knopf.textContent = "Dienstzettel speichern";
  }
}

function neuesFormular() {
  const form = $("#dienstzettel");
  form.reset();
  beruehrt.clear();
  absendenVersucht = false;
  standorteFuellen();
  form.hidden = false;
  $("#gespeichert").hidden = true;
  aktualisieren();
  form.elements.funktion.focus();
}

// ------------------------------------------------------------------ Mitarbeiterliste

function filterFuellen() {
  $('#filter select[name="standort"]').innerHTML = '<option value="">Alle</option>' +
    stand.standorte.map((s) => `<option value="${s.id}">${text(s.vertragsbezeichnung || s.name)}</option>`).join("");
}

async function listeLaden() {
  akteVergessen();
  try {
    // Das Verzeichnis liefert nur die Spalten, die diese Rolle sehen darf
    const zeilen = await api.funktion("mitarbeiter_verzeichnis");
    stand.liste = zeilen.map((z) => ({
      ...z,
      id: z.dienstverhaeltnis_id,
      heimstandort_id: z.standort_id,
      created_at: z.erfasst_am,
      person: { vorname: z.vorname, nachname: z.nachname },
    }));
    listeZeigen();
  } catch (fehler) {
    stand.liste = [];
    $("#liste").innerHTML = "";
    $("#anzahl").textContent = "";
    $("#liste-leer").hidden = false;
    $("#liste-leer").textContent = `Die Liste konnte nicht geladen werden: ${fehler.message}`;
  }
}

const tageBis = (iso, heute) => Math.round((new Date(`${iso}T00:00:00Z`) - new Date(`${heute}T00:00:00Z`)) / 86400000);

function listeZeigen() {
  const f = $("#filter").elements;
  const suche = f.suche.value.trim().toLowerCase();
  const heute = heuteIso();
  const studio = new Map(stand.standorte.map((s) => [s.id, s]));
  const funktion = new Map(stand.funktionen.map((x) => [x.id, x]));
  const art = { vollzeit: "Vollzeit", teilzeit: "Teilzeit", geringfuegig: "Geringfügig" };

  const aktiv = (d) => !d.austritt || d.austritt >= heute;
  const passt = {
    aktiv,
    neu: (d) => aktiv(d) && tageBis(heute, d.created_at.slice(0, 10)) <= 14,
    befristung: (d) => aktiv(d) && d.befristet_bis && tageBis(d.befristet_bis, heute) >= 0 && tageBis(d.befristet_bis, heute) <= 30,
    ausgetreten: (d) => !aktiv(d),
    alle: () => true,
  }[f.status.value];

  let zeilen = stand.liste.filter((d) => {
    if (!passt(d)) return false;
    if (f.standort.value && d.heimstandort_id !== f.standort.value) return false;
    if (suche) {
      const name = `${d.person?.vorname || ""} ${d.person?.nachname || ""}`.toLowerCase();
      if (!suche.split(/\s+/).every((teil) => name.includes(teil))) return false;
    }
    return true;
  });

  const sortierer = {
    erfasst: (a, b) => b.created_at.localeCompare(a.created_at),
    name: (a, b) => `${a.person?.nachname} ${a.person?.vorname}`.localeCompare(`${b.person?.nachname} ${b.person?.vorname}`, "de"),
    eintritt: (a, b) => b.eintritt.localeCompare(a.eintritt),
    befristung: (a, b) => {
      const ende = (d) => (d.befristet_bis && d.befristet_bis >= heute ? d.befristet_bis : "9999");
      return ende(a).localeCompare(ende(b));
    },
  }[f.sortierung.value];
  zeilen = zeilen.sort(sortierer);

  const gesamt = stand.liste.length;
  $("#anzahl").textContent = gesamt ? `${zeilen.length} von ${gesamt} Einträgen` : "";
  $("#liste-leer").hidden = zeilen.length > 0;
  $("#liste-leer").innerHTML = gesamt
    ? "Keine Treffer. Ändere die Suche oder die Filter."
    : stand.erfassbareFunktionen.length
      ? 'Noch keine Mitarbeiter erfasst. <a href="#erfassen">Ersten Dienstzettel erfassen</a>'
      : "Noch keine Mitarbeiter erfasst.";

  const r = stand.recht;
  $("#liste-kopf").innerHTML = [
    "<th scope=\"col\">Name</th>",
    "<th scope=\"col\">Arbeitsort</th>",
    "<th scope=\"col\">Funktion</th>",
    r.sieht_kontakt ? "<th scope=\"col\">Kontakt</th>" : "",
    r.sieht_personendaten ? "<th scope=\"col\">Stunden</th>" : "",
    "<th scope=\"col\" class=\"zahl\">Dienstantritt</th>",
    r.sieht_personendaten ? "<th scope=\"col\" class=\"zahl\">Befristet bis</th>" : "",
  ].join("");

  $("#liste").innerHTML = zeilen.map((d) => {
    const p = d.person;
    const s = studio.get(d.heimstandort_id);
    const merkmale = [];
    if (tageBis(heute, d.created_at.slice(0, 10)) <= 7) merkmale.push('<span class="merkmal">neu</span>');
    // Nach Ablauf der Befristung läuft der Vertrag automatisch unbefristet weiter
    let befristung = !d.befristet_bis || d.befristet_bis < heute ? "unbefristet" : datumAT(d.befristet_bis);
    if (d.befristet_bis && aktiv(d)) {
      const rest = tageBis(d.befristet_bis, heute);
      if (rest >= 0 && rest <= 30) {
        befristung = `<span class="merkmal merkmal-frist">${rest === 0 ? "heute" : `in ${rest} ${rest === 1 ? "Tag" : "Tagen"}`}</span> ${befristung}`;
      }
    }
    if (d.austritt && d.austritt < heute) merkmale.push('<span class="merkmal merkmal-aus">ausgetreten</span>');
    else if (d.angemeldet === false) merkmale.push('<span class="merkmal merkmal-fehlt">noch nicht angemeldet</span>');
    return `<tr>
      <td><a class="name" href="#akte/${text(d.id)}/uebersicht">${text(p ? `${p.nachname} ${p.vorname}` : "–")}</a> ${merkmale.join(" ")}</td>
      <td>${text(s ? s.vertragsbezeichnung || s.name : "–")}</td>
      <td>${text(funktion.get(d.funktion_id)?.name || "–")}</td>
      ${r.sieht_kontakt ? `<td class="kontakt">${kontakt(d)}</td>` : ""}
      ${r.sieht_personendaten ? `<td>${text(`${Number(d.wochenstunden).toLocaleString("de-DE")} h, ${art[d.beschaeftigungsart] || ""}`)}</td>` : ""}
      <td class="zahl">${datumAT(d.eintritt)}</td>
      ${r.sieht_personendaten ? `<td class="zahl">${befristung}</td>` : ""}
    </tr>`;
  }).join("");
}

function kontakt(d) {
  const teile = [];
  if (d.telefon) teile.push(`<a href="tel:${text(d.telefon.replace(/[^+0-9]/g, ""))}">${text(d.telefon)}</a>`);
  if (d.email) teile.push(`<a href="mailto:${text(d.email)}">${text(d.email)}</a>`);
  return teile.join("<br>") || "–";
}

// ------------------------------------------------------------------ Hilfen

function text(wert) {
  return String(wert ?? "").replace(/[&<>"']/g, (z) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[z]);
}
