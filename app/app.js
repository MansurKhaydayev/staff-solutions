import * as api from "./api.js";
import { fristende, datumAT, euro } from "./fristen.js";

const $ = (sel) => document.querySelector(sel);

// Daten, die beim Start geladen werden
const stand = {
  profil: null,
  organisation: null,
  standorte: [],
  gesellschaften: new Map(),
  tarifzonen: new Map(),
  funktionen: [],
  bruttoTabelle: [],     // nur für das Büro sichtbar
  meineStandorte: null,  // nur bei Studio-/Regionalleitung
};

const BUERO = ["admin", "geschaeftsfuehrung", "hr"];
const LEITUNG = ["studioleitung", "regionalleitung"];

// ------------------------------------------------------------------ Start

document.addEventListener("DOMContentLoaded", () => {
  $("#anmelde-formular").addEventListener("submit", anmelden);
  $("#abmelden").addEventListener("click", abmelden);
  $("#dienstzettel").addEventListener("input", vorschauAktualisieren);
  $("#dienstzettel").addEventListener("change", vorschauAktualisieren);
  $("#dienstzettel").addEventListener("submit", speichern);
  $("#dienstzettel").addEventListener("input", fehlerZuruecksetzen);
  $("#dienstzettel").addEventListener("change", fehlerZuruecksetzen);
  $("#naechster").addEventListener("click", neuesFormular);
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
    zeigeAnmeldeFehler(`Die Daten konnten nicht geladen werden: ${fehler.message}`);
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
    await api.anmelden(daten.get("email").trim(), daten.get("passwort"));
    await start();
  } catch (fehler) {
    zeigeAnmeldeFehler(
      fehler.status === 400
        ? "E-Mail oder Passwort stimmen nicht."
        : `Anmeldung nicht möglich: ${fehler.message}`
    );
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
    throw new api.ApiFehler(
      "Dein Zugang ist noch keiner Firma zugeordnet. Bitte das Büro, dir eine Rolle zu geben.", 403
    );
  }
  stand.profil = profile[0];
  const buero = BUERO.includes(stand.profil.rolle);

  const [orgs, standorte, gesellschaften, zonen, funktionen, brutto, zust] = await Promise.all([
    api.lesen("organisation", "select=id,name,befristung_monate"),
    api.lesen("standort", "select=id,name,art,vertragsbezeichnung,gesellschaft_id,tarifzone_id&order=name"),
    api.lesen("gesellschaft", "select=id,name,strasse,plz,ort"),
    api.lesen("tarifzone", "select=id,name"),
    api.lesen("funktion", "select=id,name&order=name"),
    buero ? api.lesen("brutto_tabelle", "select=tarifzone_id,netto,brutto,gueltig_ab&order=gueltig_ab.desc")
          : Promise.resolve([]),
    LEITUNG.includes(stand.profil.rolle) ? api.lesen("zustaendigkeit", "select=standort_id")
                                         : Promise.resolve(null),
  ]);

  stand.organisation = orgs[0];
  stand.gesellschaften = new Map(gesellschaften.map((g) => [g.id, g]));
  stand.tarifzonen = new Map(zonen.map((z) => [z.id, z]));
  stand.funktionen = funktionen;
  stand.bruttoTabelle = brutto;
  stand.meineStandorte = zust ? new Set(zust.map((z) => z.standort_id)) : null;
  stand.standorte = standorte.filter((s) => !stand.meineStandorte || stand.meineStandorte.has(s.id));

  $("#wer").textContent = `${user.email}, ${rolleText(stand.profil.rolle)}`;
  auswahlFuellen();
}

function rolleText(rolle) {
  return {
    admin: "Admin", geschaeftsfuehrung: "Geschäftsführung", hr: "Personalbüro",
    regionalleitung: "Regionalleitung", studioleitung: "Studioleitung", mitarbeiter: "Mitarbeiter",
  }[rolle] || rolle;
}

function auswahlFuellen() {
  const studio = $('select[name="standort"]');
  studio.innerHTML = '<option value="">Bitte wählen</option>' + stand.standorte
    .map((s) => `<option value="${s.id}">${text(s.vertragsbezeichnung || s.name)}</option>`).join("");
  const funktion = $('select[name="funktion"]');
  funktion.innerHTML = '<option value="">Bitte wählen</option>' + stand.funktionen
    .map((f) => `<option value="${f.id}">${text(f.name)}</option>`).join("");
}

// ------------------------------------------------------------------ Seiten

function seiteZeigen() {
  const ziel = location.hash.replace("#", "") || "erfassen";
  for (const name of ["erfassen", "mitarbeiter"]) {
    $(`#seite-${name}`).hidden = name !== ziel;
  }
  document.querySelectorAll(".navigation a").forEach((a) => {
    if (a.dataset.ziel === ziel) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (ziel === "mitarbeiter") listeLaden();
}

// ------------------------------------------------------------------ Vorschau (markierte Spalte)

function formWerte() {
  const f = new FormData($("#dienstzettel"));
  const zahl = (n) => (f.get(n) === "" || f.get(n) === null ? null : Number(f.get(n)));
  return {
    standort: stand.standorte.find((s) => s.id === f.get("standort")) || null,
    funktion: stand.funktionen.find((x) => x.id === f.get("funktion")) || null,
    eintritt: f.get("eintritt") || null,
    art: f.get("beschaeftigungsart"),
    stunden: zahl("wochenstunden"),
    netto: zahl("netto"),
    zulage: zahl("leiterzulage"),
    sonderzahlung: f.get("sonderzahlung") === "on",
  };
}

function istLeitung(funktion) {
  return Boolean(funktion && /leitung|regional/i.test(funktion.name));
}

function bruttoSuchen(standort, netto, eintritt) {
  return stand.bruttoTabelle.find(
    (b) => b.tarifzone_id === standort.tarifzone_id && Number(b.netto) === netto && b.gueltig_ab <= eintritt
  );
}

function setze(id, html) {
  $(id).innerHTML = html;
}
const markiert = (wert, zusatz = "") =>
  `<span class="wert">${text(wert)}</span>${zusatz ? `<small>${text(zusatz)}</small>` : ""}`;
const leer = (t) => `<span class="leer">${text(t)}</span>`;

function vorschauAktualisieren() {
  const w = formWerte();
  const leitung = istLeitung(w.funktion);
  $("#feld-zulage").hidden = !leitung;

  if (w.standort) {
    const g = stand.gesellschaften.get(w.standort.gesellschaft_id);
    setze("#a-gmbh", markiert(g.name, [g.strasse, [g.plz, g.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")));
    setze("#a-arbeitsort", markiert(w.standort.vertragsbezeichnung || w.standort.name));
  } else {
    setze("#a-gmbh", leer("Studio wählen"));
    setze("#a-arbeitsort", leer("Studio wählen"));
  }

  const monate = stand.organisation?.befristung_monate ?? 3;
  if (w.eintritt && monate > 0) {
    setze("#a-befristung", markiert(datumAT(fristende(w.eintritt, monate)), `${monate} Monate ab Dienstantritt`));
  } else {
    setze("#a-befristung", leer(w.eintritt ? "unbefristet" : "Dienstantritt eintragen"));
  }

  if (!BUERO.includes(stand.profil.rolle)) {
    setze("#a-brutto", leer("ermittelt das Büro"));
  } else if (w.netto === null || !w.standort || !w.eintritt) {
    setze("#a-brutto", leer("Studio, Dienstantritt und Netto eintragen"));
  } else {
    const treffer = bruttoSuchen(w.standort, w.netto, w.eintritt);
    const zone = stand.tarifzonen.get(w.standort.tarifzone_id)?.name;
    setze("#a-brutto", treffer
      ? markiert(`€ ${euro(treffer.brutto)}`, `Brutto-Tabelle, Tarifzone ${zone}`)
      : leer(`Nicht in der Tabelle (Tarifzone ${zone}). Wird als offen markiert.`));
  }

  const vereinbarungen = [];
  if (w.sonderzahlung) vereinbarungen.push("Sonderzahlungen (13./14. Gehalt)");
  if (leitung && w.zulage > 0) vereinbarungen.push(`Leiterzulage € ${euro(w.zulage)} netto`);
  setze("#a-vereinbarungen", vereinbarungen.length
    ? vereinbarungen.map((v) => markiert(v)).join("<br>")
    : leer("keine"));

  const hinweis = $("#hinweis-stunden");
  let text_ = "";
  if (w.art === "vollzeit" && w.stunden !== null && w.stunden < 38) {
    text_ = `Vollzeit mit ${w.stunden} Stunden pro Woche. Stimmt das?`;
  } else if (w.art === "teilzeit" && w.stunden !== null && w.stunden >= 40) {
    text_ = `Teilzeit mit ${w.stunden} Stunden pro Woche. Ist Vollzeit gemeint?`;
  }
  hinweis.textContent = text_;
  hinweis.hidden = !text_;
}

// ------------------------------------------------------------------ Prüfen und speichern

function ibanGueltig(iban) {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const umgestellt = s.slice(4) + s.slice(0, 4);
  const ziffern = umgestellt.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const z of ziffern) rest = (rest * 10 + Number(z)) % 97;
  return rest === 1;
}

function pruefen(form) {
  const fehler = [];
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  const markieren = (name, meldung) => {
    form.elements[name].setAttribute("aria-invalid", "true");
    fehler.push({ name, meldung });
  };
  const pflicht = {
    standort: "Studio", funktion: "Funktion", eintritt: "Dienstantritt",
    beschaeftigungsart: "Beschäftigungsart", wochenstunden: "Stunden pro Woche",
    vorname: "Vorname", nachname: "Nachname", netto: "Netto pro Monat",
  };
  for (const [name, bezeichnung] of Object.entries(pflicht)) {
    if (!String(form.elements[name].value).trim()) markieren(name, `${bezeichnung} fehlt.`);
  }
  const sv = form.elements.sv_nummer.value.replace(/\s+/g, "");
  if (sv && !/^\d{10}$/.test(sv)) markieren("sv_nummer", "Die Versicherungsnummer hat 10 Ziffern.");
  const iban = form.elements.iban.value;
  if (iban.trim() && !ibanGueltig(iban)) markieren("iban", "Die IBAN ist nicht gültig. Bitte noch einmal prüfen.");
  const zulage = form.elements.leiterzulage.value;
  if (!$("#feld-zulage").hidden && zulage !== "" && Number(zulage) <= 0) {
    markieren("leiterzulage", "Die Leiterzulage muss größer als 0 sein oder leer bleiben.");
  }
  return fehler;
}

// Sobald ein markiertes Feld ausgefüllt wird, verschwindet seine Markierung.
// Sind alle behoben, verschwindet auch die Fehlermeldung.
function fehlerZuruecksetzen(ereignis) {
  const feld = ereignis.target;
  if (feld.getAttribute?.("aria-invalid") === "true" && String(feld.value).trim()) {
    feld.removeAttribute("aria-invalid");
  }
  if (!$("#dienstzettel").querySelector('[aria-invalid="true"]')) {
    $("#speicher-fehler").hidden = true;
  }
}

async function speichern(ereignis) {
  ereignis.preventDefault();
  const form = ereignis.target;
  const fehlerEl = $("#speicher-fehler");
  fehlerEl.hidden = true;

  const fehler = pruefen(form);
  if (fehler.length) {
    fehlerEl.textContent = fehler.map((f) => f.meldung).join(" ");
    fehlerEl.hidden = false;
    form.elements[fehler[0].name].focus();
    return;
  }

  const f = form.elements;
  const leer = (v) => (String(v).trim() === "" ? null : String(v).trim());
  const zahl = (v) => (String(v).trim() === "" ? null : Number(v));
  const zulageSichtbar = !$("#feld-zulage").hidden;

  const parameter = {
    p_standort_id: f.standort.value,
    p_funktion_id: f.funktion.value,
    p_vorname: f.vorname.value.trim(),
    p_nachname: f.nachname.value.trim(),
    p_eintritt: f.eintritt.value,
    p_beschaeftigungsart: f.beschaeftigungsart.value,
    p_wochenstunden: Number(f.wochenstunden.value),
    p_netto: Number(f.netto.value),
    p_anrede: leer(f.anrede.value),
    p_geburtsdatum: leer(f.geburtsdatum.value),
    p_strasse: leer(f.strasse.value),
    p_plz: leer(f.plz.value),
    p_ort: leer(f.ort.value),
    p_telefon: leer(f.telefon.value),
    p_email: leer(f.email.value),
    p_staatsangehoerigkeit: leer(f.staatsangehoerigkeit.value),
    p_sv_nummer: leer(f.sv_nummer.value),
    p_iban: leer(f.iban.value),
    p_bic: leer(f.bic.value),
    p_arbeitstage_woche: zahl(f.arbeitstage.value),
    p_sonderzahlung: f.sonderzahlung.checked,
    p_leiterzulage_netto: zulageSichtbar ? zahl(f.leiterzulage.value) : null,
  };

  const knopf = $("#speichern");
  knopf.disabled = true;
  knopf.textContent = "Wird gespeichert …";
  try {
    const dvId = await api.funktion("dienstzettel_erfassen", parameter);
    const [dv] = await api.lesen("dienstverhaeltnis", `select=befristet_bis&id=eq.${dvId}`);
    const name = `${parameter.p_vorname} ${parameter.p_nachname}`;
    const studio = stand.standorte.find((s) => s.id === parameter.p_standort_id);
    $("#gespeichert-text").textContent =
      `${name} ist ab ${datumAT(parameter.p_eintritt)} in ${studio.vertragsbezeichnung || studio.name} angelegt.` +
      (dv?.befristet_bis ? ` Befristet bis ${datumAT(dv.befristet_bis)}.` : "");
    form.hidden = true;
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
  form.hidden = false;
  $("#gespeichert").hidden = true;
  vorschauAktualisieren();
  form.elements.standort.focus();
}

// ------------------------------------------------------------------ Mitarbeiterliste

async function listeLaden() {
  const tbody = $("#liste");
  tbody.innerHTML = "";
  try {
    const [dvs, personen] = await Promise.all([
      api.lesen("dienstverhaeltnis",
        "select=id,mitarbeiter_id,heimstandort_id,funktion_id,beschaeftigungsart,wochenstunden,eintritt,befristet_bis,austritt&order=eintritt.desc"),
      api.lesen("mitarbeiter", "select=id,vorname,nachname"),
    ]);
    const person = new Map(personen.map((p) => [p.id, p]));
    const studio = new Map(stand.standorte.map((s) => [s.id, s]));
    const funktion = new Map(stand.funktionen.map((x) => [x.id, x]));
    const art = { vollzeit: "Vollzeit", teilzeit: "Teilzeit", geringfuegig: "Geringfügig" };

    $("#liste-leer").hidden = dvs.length > 0;
    tbody.innerHTML = dvs.map((d) => {
      const p = person.get(d.mitarbeiter_id);
      const s = studio.get(d.heimstandort_id);
      return `<tr>
        <td>${text(p ? `${p.nachname} ${p.vorname}` : "–")}</td>
        <td>${text(s ? s.vertragsbezeichnung || s.name : "–")}</td>
        <td>${text(funktion.get(d.funktion_id)?.name || "–")}</td>
        <td>${text(`${Number(d.wochenstunden).toLocaleString("de-AT")} h, ${art[d.beschaeftigungsart] || ""}`)}</td>
        <td class="zahl">${datumAT(d.eintritt)}</td>
        <td class="zahl">${d.befristet_bis ? datumAT(d.befristet_bis) : "unbefristet"}</td>
      </tr>`;
    }).join("");
  } catch (fehler) {
    $("#liste-leer").hidden = false;
    $("#liste-leer").textContent = `Die Liste konnte nicht geladen werden: ${fehler.message}`;
  }
}

// ------------------------------------------------------------------ Hilfen

function text(wert) {
  return String(wert ?? "").replace(/[&<>"']/g, (z) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[z]);
}
