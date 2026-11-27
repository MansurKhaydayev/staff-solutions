// Personalakte: eine Seite je Dienstverhältnis mit Reitern.
// Adresse: #akte/<dienstverhältnis>/<reiter>. Was angezeigt wird, entscheidet die Datenbank
// (akte_kopf liefert nur, was die Rolle sehen darf); die Reiter richten sich danach.
import * as api from "./api.js";
import { heuteIso } from "./pruefungen.js";
import { $, text, ART, stunden, geld, datum, tageZwischen, liste, avatarFarbe } from "./hilfen.js";
import { austrittZeigen, statusEtikett, etikettHtml, imDienst } from "./akte_austritt.js";

// Reiter: Schlüssel, Name, wer ihn sieht, Modul (wird erst beim Öffnen geladen)
const REITER = [
  { name: "uebersicht", titel: "Übersicht", sichtbar: () => true },
  { name: "stunden", titel: "Stunden", sichtbar: () => true },
  { name: "verlauf", titel: "Anstellung & Verlauf", sichtbar: (r) => r.personendaten, modul: "./akte_verlauf.js" },
  { name: "dokumente", titel: "Dokumente", sichtbar: (r) => r.dokumente, modul: "./akte_dokumente.js" },
  { name: "lohn", titel: "Lohnverrechnung", sichtbar: (r) => r.lohnverrechnung, modul: "./akte_stammdaten.js" },
  { name: "protokoll", titel: "Protokoll", sichtbar: (r) => r.buero, modul: "./akte_protokoll.js" },
];

let geladen = { dv: null, kopf: null };

export async function akteZeigen(stand, dvId, reiter = "uebersicht") {
  const ziel = $("#akte-inhalt");
  if (geladen.dv !== dvId) {
    $("#akte-kopf").innerHTML = '<p class="leer-zustand">Akte wird geladen …</p>';
    $("#akte-hinweise").innerHTML = "";
    $("#akte-austritt").innerHTML = "";
    $("#akte-reiter").innerHTML = "";
    ziel.innerHTML = "";
    try {
      geladen = { dv: dvId, kopf: await api.funktion("akte_kopf", { p_dienstverhaeltnis_id: dvId }) };
    } catch (fehler) {
      geladen = { dv: null, kopf: null };
      $("#akte-kopf").innerHTML = `<h1 class="seitentitel">Akte</h1><p class="fehler">${text(fehler.message)}</p>`;
      return;
    }
  }
  const kopf = geladen.kopf;
  const erlaubt = REITER.filter((r) => r.sichtbar(kopf.rechte));
  const aktiv = erlaubt.find((r) => r.name === reiter);
  if (!aktiv) {
    history.replaceState(null, "", `#akte/${dvId}/uebersicht`);
    return akteZeigen(stand, dvId, "uebersicht");
  }

  const neuLaden = async () => {
    geladen = { dv: null, kopf: null };
    await akteZeigen(stand, dvId, aktiv.name);
  };
  kopfZeichnen(kopf, stand);
  hinweiseZeichnen(kopf);
  $("#akte-reiter").innerHTML = erlaubt.map((r) =>
    `<a href="#akte/${text(dvId)}/${r.name}"${r === aktiv ? ' aria-current="page"' : ""}>${text(r.titel)}</a>`).join("");
  await austrittZeigen($("#akte-austritt"), kopf, stand, neuLaden);
  if (aktiv.name === "uebersicht") return uebersichtZeichnen(ziel, kopf, stand, neuLaden);
  if (aktiv.name === "stunden") {
    ziel.innerHTML = `<p class="leer-zustand">Stunden, Urlaub und Krankenstand kommen mit der Stundenauswertung.
      Bis dahin werden die Stunden wie bisher geführt.</p>`;
    return;
  }
  try {
    const modul = await import(aktiv.modul);
    await modul.zeigen(ziel, kopf, stand, neuLaden);
  } catch (fehler) {
    ziel.innerHTML = `<p class="fehler">Dieser Bereich konnte nicht geladen werden: ${text(fehler.message)}</p>`;
  }
}

// Nach Änderungen in anderen Seiten (z. B. neuer Dienstzettel) die Akte neu holen
export function akteVergessen() {
  geladen = { dv: null, kopf: null };
}

function status(k, heute) {
  if (["nicht_angetreten", "storno_ausstaendig", "nicht_angetreten_gemeldet"].includes(k.status)) return "";
  if (k.austritt && k.austritt < heute) return `ausgetreten am ${datum(k.austritt)}`;
  if (k.austritt && k.status === "austritt_bestaetigt") return "";
  if (k.eintritt > heute) return `beginnt am ${datum(k.eintritt)}`;
  if (k.befristet_bis && k.befristet_bis >= heute) return `befristet bis ${datum(k.befristet_bis)}`;
  return "aktiv";
}

// Unterschriftsmappe: Personalbüro und Leitungen mit Dokumente-Recht (prüft auch die Datenbank)
const darfMappe = (k, stand) => k.rechte.buero || (k.rechte.dokumente && ["studioleitung", "regionalleitung"].includes(stand?.profil?.rolle));

function kopfZeichnen(k, stand) {
  const aktiv = imDienst(k.status, k.austritt, heuteIso());
  $("#akte-kopf").innerHTML = `
    <span class="avatar avatar-gross ${avatarFarbe(`${k.nachname} ${k.vorname}`)}" data-i="${text(`${(k.nachname || "")[0] || ""}${(k.vorname || "")[0] || ""}`.toUpperCase())}" aria-hidden="true"></span>
    <h1 class="seitentitel">${text(`${k.nachname} ${k.vorname}`)}</h1>
    <p class="akte-unterzeile">${text([k.funktion, k.arbeitsort, k.gesellschaft].filter(Boolean).join(", "))}</p>
    <p class="akte-status">${text(status(k, heuteIso()))}
      ${etikettHtml(statusEtikett(k.status, k))}
      ${aktiv && k.angemeldet === false ? '<span class="merkmal merkmal-fehlt">noch nicht angemeldet</span>' : ""}</p>
    ${aktiv && darfMappe(k, stand) ? `<p class="akte-aktionen"><a class="knopf knopf-leise" href="#mappe/${text(k.dienstverhaeltnis_id)}">Unterschriftsmappe</a></p>` : ""}`;
}

function hinweiseZeichnen(k) {
  const heute = heuteIso();
  const h = [];
  if (k.angemeldet === false && k.dringend_grund) {
    h.push(`Dringende Anmeldung: ${k.dringend_grund}. Erst arbeiten lassen, wenn „angemeldet“ angezeigt wird.`);
  }
  for (const tag of k.nachweis_fehlt || []) h.push(`Nachweis fehlt: Stundenanpassung ab ${datum(tag)}`);
  if (k.sv_nachreichen) h.push("Versicherungsnummer wird nachgereicht");
  if (k.befristet_bis && k.befristet_bis >= heute && (!k.austritt || k.austritt >= heute)) {
    const rest = tageZwischen(heute, k.befristet_bis);
    if (rest <= 30) h.push(rest === 0 ? "Befristung endet heute" : `Befristung endet in ${rest} ${rest === 1 ? "Tag" : "Tagen"}`);
  }
  if (k.onboarding && k.onboarding.erledigt < k.onboarding.gesamt) {
    h.push(`Onboarding unvollständig (${k.onboarding.erledigt} von ${k.onboarding.gesamt})`);
  }
  for (const u of k.onboarding?.klaerung || []) h.push(`Klärung mit Geschäftsführung: ${u}`);
  $("#akte-hinweise").innerHTML = h.length
    ? `<ul class="hinweise" aria-label="Offene Punkte">${h.map((x) => `<li>${text(x)}</li>`).join("")}</ul>` : "";
}

function standText(s) {
  return `${stunden(s.wochenstunden)} (${ART[s.beschaeftigungsart] || s.beschaeftigungsart}), ` +
    `${s.arbeitstage_woche || "–"} Tage pro Woche`;
}

async function uebersichtZeichnen(ziel, k, stand, neuLaden) {
  const r = k.rechte;
  const teile = [];

  if (r.personendaten) {
    teile.push(`<section class="akte-block"><h2>Person</h2>${liste([
      ["Anrede", text(k.anrede)], ["Geburtsdatum", datum(k.geburtsdatum)],
      ["Adresse", text(`${k.strasse || ""}, ${k.plz || ""} ${k.ort || ""}`)],
    ])}<div id="aenderung-personendaten"></div></section>`);
  }
  if (r.kontakt) {
    teile.push(`<section class="akte-block"><h2>Kontakt</h2>${liste([
      ["Telefon", k.telefon ? `<a href="tel:${text(k.telefon.replace(/[^+0-9]/g, ""))}">${text(k.telefon)}</a>` : "–"],
      ["E-Mail", k.email ? `<a href="mailto:${text(k.email)}">${text(k.email)}</a>` : "–"],
    ])}</section>`);
  }
  if (r.personendaten && k.stand) {
    const befristung = !k.befristet_bis || k.befristet_bis < heuteIso() ? "unbefristet" : `bis ${datum(k.befristet_bis)}`;
    teile.push(`<section class="akte-block"><h2>Anstellung heute</h2>${liste([
      ["Arbeitszeit", text(standText(k.stand))],
      ["Dienstantritt", datum(k.eintritt)], ["Befristung", text(befristung)],
      ...(k.kuenftig || []).map((s) => ["Geplant", text(`ab ${datum(s.gueltig_ab)}: ${standText(s)}`)]),
    ])}</section>`);
  }
  if (r.entgelt && k.entgelt) {
    teile.push(`<section class="akte-block"><h2>Entgelt heute</h2>${liste([
      ["Netto pro Monat", geld(k.entgelt.netto)], ["Brutto pro Monat", geld(k.entgelt.brutto)],
      ["Zulagen", (k.zulagen || []).length ? k.zulagen.map((z) => text(`${z.art} ${geld(z.netto)} netto`)).join("<br>") : "keine"],
      ["13./14. Gehalt", k.sonderzahlung ? "ja" : "nein"],
    ])}</section>`);
  }
  if (r.dokumente && k.onboarding) {
    teile.push(`<section class="akte-block"><h2>Onboarding</h2>
      <p class="akte-zahl">${k.onboarding.erledigt} von ${k.onboarding.gesamt} erledigt</p>
      <progress class="fortschritt" max="${Number(k.onboarding.gesamt) || 1}" value="${Number(k.onboarding.erledigt) || 0}" aria-label="Onboarding-Fortschritt"></progress>
      <ul class="checkliste" id="onboarding-liste"></ul></section>`);
  }
  teile.push(`<section class="akte-block"><h2>Urlaub</h2>${liste([["Resturlaub", "kommt mit der Stundenauswertung"]])}</section>`);
  ziel.innerHTML = `<div id="uebersicht-dialog"></div><div class="akte-raster">${teile.join("")}</div>`;

  if (r.dokumente && k.onboarding) {
    try {
      const stand_ = await api.funktion("onboarding_stand", { p_dienstverhaeltnis_id: k.dienstverhaeltnis_id });
      $("#onboarding-liste").innerHTML = stand_.map((u) => checklistenZeile(u)).join("");
    } catch (fehler) {
      $("#onboarding-liste").innerHTML = `<li class="fehler">${text(fehler.message)}</li>`;
    }
  }
  if (r.buero && r.personendaten) {
    try {
      const { aenderungKnopf } = await import("./akte_stammdaten.js");
      aenderungKnopf($("#aenderung-personendaten"), "personendaten", k, stand, neuLaden, $("#uebersicht-dialog"));
    } catch {
      /* Änderungen eintragen kommt mit dem Modul Stammdaten */
    }
  }
}

const STATUS = {
  erledigt: "erledigt", abgelehnt: "abgelehnt (freiwillig)", klaerung: "Klärung mit Geschäftsführung",
  geklaert: "geklärt", fehlt: "fehlt",
};
export function checklistenZeile(u) {
  return `<li class="check-${text(u.status)}"><span class="check-zeichen" aria-hidden="true"></span>
    <span>${text(u.bezeichnung)}${u.pflicht ? "" : " <small>(freiwillig)</small>"}</span>
    <span class="check-status">${text(STATUS[u.status] || u.status)}</span></li>`;
}
