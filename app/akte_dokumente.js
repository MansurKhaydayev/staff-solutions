// Reiter „Dokumente“: Unterlagen nach Kategorie, Onboarding-Checkliste, Hochladen, Ansehen, Ersetzen.
// Nichts wird gelöscht: Eine falsche Datei wird ersetzt, die alte bleibt unter „frühere Fassungen“.
import * as api from "./api.js";
import { dateiPruefen, dateiPfad, sha256 } from "./datei.js";
import { checklistenZeile } from "./akte.js";
import { $, text, datum } from "./hilfen.js";

export const KATEGORIEN = [
  { wert: "anmeldung", titel: "Anmeldung" },
  { wert: "onboarding", titel: "Onboarding" },
  { wert: "vereinbarung", titel: "Vereinbarungen" },
  { wert: "abmeldung", titel: "Abmeldung" },
  { wert: "nachweis_personendaten", titel: "Nachweise", gruppe: "nachweise" },
  { wert: "nachweis_lohnverrechnung", titel: "Nachweise", gruppe: "nachweise" },
  { wert: "sonstiges", titel: "Sonstiges" },
];
const NAMEN = { nachweis_personendaten: "Nachweis Personendaten", nachweis_lohnverrechnung: "Nachweis Lohnverrechnung",
  dienstzettel_papier: "Dienstzettel (Papier, Notlösung)" };

// Welche Kategorien darf diese Rolle hochladen? (Die Datenbank prüft es noch einmal.)
function erlaubteKategorien(r) {
  if (!r.buero) return r.hochladen_onboarding ? ["onboarding"] : [];
  const liste = KATEGORIEN.map((k) => k.wert).filter((k) => {
    if (k === "vereinbarung") return r.entgelt;
    if (["anmeldung", "abmeldung", "nachweis_lohnverrechnung"].includes(k)) return r.lohnverrechnung;
    if (k === "nachweis_personendaten") return r.personendaten;
    return true;
  });
  // Papier-Dienstzettel (z. B. iPad defekt) landet bei den Vereinbarungen
  return r.entgelt ? [...liste, "dienstzettel_papier"] : liste;
}

export async function zeigen(ziel, kopf, stand, neuLaden) {
  const r = kopf.rechte;
  const dv = kopf.dienstverhaeltnis_id;
  const [doks, checkliste] = await Promise.all([
    api.lesen("dokument", `select=*&dienstverhaeltnis_id=eq.${dv}&order=created_at.desc`),
    api.funktion("onboarding_stand", { p_dienstverhaeltnis_id: dv }),
  ]);
  const erlaubt = erlaubteKategorien(r);

  ziel.innerHTML = `
    ${erlaubt.length ? '<div class="aktionen"><button type="button" class="knopf knopf-haupt" id="hochladen-oeffnen">Unterlage hochladen</button></div>' : ""}
    <div id="hochladen-bereich"></div>
    <section class="akte-block" id="dokumente-onboarding"><h2>Onboarding-Unterlagen</h2>
      <ul class="checkliste">${checkliste.map((u) => checklistenZeile(u) + (r.buero && u.status === "klaerung"
        ? `<li class="klaerung-aktion"><button type="button" class="knopf knopf-leise" data-klaerung="${text(u.unterlage_id)}">Klärung schließen</button></li>`
        : "")).join("")}</ul>
      <div id="klaerung-bereich"></div></section>
    <div id="dz-bereich"></div>
    <div id="dokument-gruppen">${gruppenHtml(doks, r)}</div>`;

  const oeffnen = (vorgabe) => hochladenDialog($("#hochladen-bereich"), vorgabe, kopf, stand, neuLaden, checkliste);
  $("#hochladen-oeffnen")?.addEventListener("click", () => oeffnen({}));
  // onclick statt addEventListener: ziel bleibt bestehen, sonst stapeln sich die Handler bei jedem Neuladen
  ziel.onclick = async (e) => {
    const k = e.target.closest("button");
    if (!k) return;
    if (k.dataset.klaerung) return klaerungZeigen($("#klaerung-bereich"), dv, k.dataset.klaerung, neuLaden);
    const dz = doks.find((x) => x.id === (k.dataset.uebermittelt || k.dataset.ausgehaendigt || k.dataset.neu));
    if (dz && k.dataset.uebermittelt) {
      k.disabled = true;
      try {
        await api.funktion("dienstzettel_vermerken", { p_dokument_id: dz.id, p_was: "uebermittelt" });
        return await neuLaden();
      } catch (f) { k.disabled = false; return alertText(k, f.message); }
    }
    if (dz) return dienstzettelAktion($("#dz-bereich"), k.dataset.ausgehaendigt ? "ausgehaendigt" : "neu", dz, neuLaden);
    const dok = doks.find((x) => x.id === (k.dataset.ansehen || k.dataset.laden || k.dataset.nachweis || k.dataset.ersetzen));
    if (k.dataset.ansehen || k.dataset.laden) return dateiOeffnen(k, dok.datei_pfad, Boolean(k.dataset.laden));
    if (k.dataset.nachweis || k.dataset.ersetzen) {
      return oeffnen({ kategorie: dok.kategorie, bezeichnung: dok.bezeichnung, dokumentId: dok.id,
        onboardingUnterlageId: dok.onboarding_unterlage_id, ersetzen: Boolean(k.dataset.ersetzen) });
    }
  };
}

const ART_AUSGEHAENDIGT = { ausdruck: "Ausdruck", email: "E-Mail" };

function dienstzettelVermerke(d) {
  const v = [];
  if (d.papier) v.push('<span class="merkmal">Papier (Scan)</span>');
  if (d.neu_angefordert_am) v.push(`<span class="merkmal merkmal-fehlt">neu unterschreiben lassen</span>
    <small class="vermerk">Grund: ${text(d.neu_angefordert_grund || "")}</small>`);
  else if (d.status === "unterschrieben" && !d.ersetzt_durch) v.push('<span class="merkmal">Arbeitgeber-Unterschrift fehlt</span>');
  if (d.uebermittelt_am) v.push(`<small class="vermerk">übermittelt am ${text(datum(d.uebermittelt_am))}</small>`);
  if (d.ausgehaendigt_am) {
    v.push(`<small class="vermerk">ausgehändigt am ${text(datum(d.ausgehaendigt_am))} (${text(ART_AUSGEHAENDIGT[d.ausgehaendigt_art] || "")})</small>`);
  }
  return v.length ? ` ${v.join(" ")}` : "";
}

function dienstzettelKnoepfe(d) {
  if (d.ersetzt_durch || d.neu_angefordert_am) return [];
  const k = [];
  const knopf = (attr, t) => `<button type="button" class="knopf knopf-leise" data-${attr}="${text(d.id)}">${t}</button>`;
  if (d.status === "abgeschlossen" && !d.uebermittelt_am) k.push(knopf("uebermittelt", "An Lohnverrechner übermittelt"));
  if (d.status === "abgeschlossen" && !d.ausgehaendigt_am) k.push(knopf("ausgehaendigt", "Ausgehändigt …"));
  k.push(knopf("neu", "Neu unterschreiben lassen"));
  return k;
}

// Kleines Formular unter den Dokumenten: ausgehändigt (Art) oder neu unterschreiben lassen (Grund)
function dienstzettelAktion(bereich, art, dok, neuLaden) {
  const ausgeh = art === "ausgehaendigt";
  bereich.innerHTML = `
    <form class="dialog" id="dz-aktion" novalidate>
      <h3>${ausgeh ? "Dienstzettel ausgehändigt" : "Dienstzettel neu unterschreiben lassen"}</h3>
      ${ausgeh
        ? '<label class="feld"><span>Wie?</span><select name="art"><option value="ausdruck">Ausdruck</option><option value="email">E-Mail</option></select></label>'
        : `<p class="einleitung klein">Der bisherige Dienstzettel bleibt erhalten. Die Unterschriftsmappe bietet ihn danach neu an.</p>
           <label class="feld"><span>Grund (z. B. „Adresse falsch“)</span><input name="grund" maxlength="200"></label>`}
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">${ausgeh ? "Vermerken" : "Neu unterschreiben lassen"}</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = bereich.querySelector("#dz-aktion");
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fehler = form.querySelector(".fehler");
    const knopf = form.querySelector("button[type=submit]");
    try {
      if (ausgeh) {
        knopf.disabled = true;
        await api.funktion("dienstzettel_vermerken", { p_dokument_id: dok.id, p_was: "ausgehaendigt", p_art: form.elements.art.value });
      } else {
        const grund = form.elements.grund.value.trim();
        if (!grund) { fehler.textContent = "Bitte einen Grund angeben."; return; }
        knopf.disabled = true;
        await api.funktion("dienstzettel_neu_anfordern", { p_dokument_id: dok.id, p_grund: grund });
      }
      bereich.innerHTML = "";
      await neuLaden();
    } catch (f) {
      fehler.textContent = f.message;
      knopf.disabled = false;
    }
  });
  form.querySelector("select, input")?.focus();
}

function gruppenHtml(doks, r) {
  const gruppen = [];
  for (const k of KATEGORIEN) {
    const schluessel = k.gruppe || k.wert;
    let g = gruppen.find((x) => x.schluessel === schluessel);
    if (!g) gruppen.push(g = { schluessel, titel: k.titel, doks: [] });
    g.doks.push(...doks.filter((d) => d.kategorie === k.wert));
  }
  const darfHochladen = (d) => r.buero || (r.hochladen_onboarding && d.kategorie === "onboarding");
  const zeile = (d) => {
    const knoepfe = [];
    if (d.datei_pfad) {
      knoepfe.push(`<button type="button" class="knopf knopf-leise" data-ansehen="${text(d.id)}">Ansehen</button>`);
      knoepfe.push(`<button type="button" class="knopf knopf-leise" data-laden="${text(d.id)}">Herunterladen</button>`);
      // Dienstzettel werden nicht ersetzt, sondern neu unterschrieben (Mappe) oder als Papier abgelegt
      if (r.buero && !d.ersetzt_durch && d.typ !== "dienstzettel") {
        knoepfe.push(`<button type="button" class="knopf knopf-leise" data-ersetzen="${text(d.id)}">Ersetzen</button>`);
      }
      if (r.buero && d.typ === "dienstzettel") knoepfe.push(...dienstzettelKnoepfe(d));
    } else if (darfHochladen(d) && !d.ersetzt_durch && !(d.kategorie === "onboarding" && d.onboarding_ergebnis === "abgelehnt")) {
      knoepfe.push(`<button type="button" class="knopf knopf-haupt" data-nachweis="${text(d.id)}">Datei hochladen</button>`);
    }
    const art = NAMEN[d.kategorie] ? `<small>${text(NAMEN[d.kategorie])}</small><br>` : "";
    const zustand = d.datei_pfad ? `${datum(d.hochgeladen_am || d.created_at)}` : '<span class="merkmal merkmal-fehlt">Datei fehlt</span>';
    const ergebnis = (d.onboarding_ergebnis === "abgelehnt" ? ' <span class="merkmal">abgelehnt</span>' : "")
      + (d.typ === "dienstzettel" ? dienstzettelVermerke(d) : "");
    return `<tr><td>${art}${text(d.bezeichnung || "Unterlage")}${ergebnis}</td><td>${zustand}</td>
      <td class="knopf-zelle">${knoepfe.join(" ")}</td></tr>`;
  };
  const html = gruppen.filter((g) => g.doks.length).map((g) => {
    const aktuell = g.doks.filter((d) => !d.ersetzt_durch);
    const frueher = g.doks.filter((d) => d.ersetzt_durch);
    return `<section class="dokument-gruppe"><h2>${text(g.titel)}</h2>
      <div class="tabelle-rahmen"><table class="tabelle"><tbody>${aktuell.map(zeile).join("")}</tbody></table></div>
      ${frueher.length ? `<details class="frueher"><summary>frühere Fassungen (${frueher.length})</summary>
        <div class="tabelle-rahmen"><table class="tabelle"><tbody>${frueher.map(zeile).join("")}</tbody></table></div></details>` : ""}
    </section>`;
  }).join("");
  return html || '<p class="leer-zustand">Noch keine Unterlagen abgelegt.</p>';
}

// Öffnet eine Datei über einen zeitlich begrenzten Link in einem neuen Tab.
// Den Tab sofort öffnen (sonst blockiert Safari am iPad das Fenster) und danach die Adresse setzen.
async function dateiOeffnen(knopf, pfad, herunterladen) {
  const fenster = window.open("", "_blank");
  knopf.disabled = true;
  try {
    const url = await api.dateiLink(pfad, herunterladen);
    if (fenster) { fenster.opener = null; fenster.location.href = url; } else { location.href = url; }
  } catch (fehler) {
    fenster?.close();
    alertText(knopf, `Datei konnte nicht geöffnet werden: ${fehler.message}`);
  } finally {
    knopf.disabled = false;
  }
}

function alertText(knopf, meldung) {
  const p = document.createElement("p");
  p.className = "fehler";
  p.setAttribute("role", "alert");
  p.textContent = meldung;
  knopf.closest("td")?.append(p);
}

// Hochladen-Dialog. vorgabe = { kategorie, bezeichnung, dokumentId, onboardingUnterlageId, ersetzen }
// Wird auch aus anderen Reitern genutzt (Nachweis zu Stundenanpassung oder Stammdatenänderung).
export function hochladenDialog(bereich, vorgabe, kopf, stand, fertig, checkliste = []) {
  const r = kopf.rechte;
  const fest = Boolean(vorgabe.dokumentId);
  const kategorien = fest ? [vorgabe.kategorie] : erlaubteKategorien(r);
  const titel = vorgabe.ersetzen ? "Datei ersetzen" : fest ? "Datei hochladen" : "Unterlage hochladen";
  bereich.innerHTML = `
    <form class="dialog" id="hochladen-form" novalidate>
      <h3>${titel}${fest ? `: ${text(vorgabe.bezeichnung)}` : ""}</h3>
      ${vorgabe.ersetzen ? '<p class="einleitung klein">Die bisherige Datei bleibt unter „frühere Fassungen“ erhalten.</p>' : ""}
      <div class="reihe"${fest ? " hidden" : ""}>
        <label class="feld"><span>Kategorie</span>
          <select name="kategorie">${kategorien.map((k) => `<option value="${k}"${k === vorgabe.kategorie ? " selected" : ""}>${
            text(NAMEN[k] || KATEGORIEN.find((x) => x.wert === k).titel)}</option>`).join("")}</select></label>
        <label class="feld" data-nur="onboarding"><span>Unterlage</span>
          <select name="unterlage"><option value="">Bitte wählen</option>${checkliste.map((u) =>
            `<option value="${text(u.unterlage_id)}">${text(u.bezeichnung)}</option>`).join("")}</select></label>
        <label class="feld" data-nur="onboarding"><span>Ergebnis</span>
          <select name="ergebnis"><option value="unterschrieben">unterschrieben</option>
            <option value="abgelehnt">abgelehnt (Bogen mit „Nein“)</option></select></label>
        <label class="feld breit" data-nicht="onboarding"><span>Bezeichnung</span>
          <input type="text" name="bezeichnung" maxlength="120" value="${text(vorgabe.bezeichnung || "")}"></label>
      </div>
      <label class="feld"><span>Datei (PDF, JPG oder PNG, höchstens 10 MB)</span>
        <input type="file" name="datei" accept="application/pdf,image/jpeg,image/png"></label>
      ${r.buero && !fest ? '<p class="einleitung klein" data-nur="onboarding">Abgelehnt ohne Bogen? <button type="button" class="knopf knopf-leise" data-aktion="vermerk">Ablehnung ohne Datei vermerken</button></p>' : ""}
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">Hochladen</button>
        <button type="button" class="knopf knopf-leise" data-aktion="erneut" hidden>Erneut versuchen</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#hochladen-form");
  const e = form.elements;
  const meldung = (t) => { form.querySelector(".fehler").textContent = t; };
  const sichtbarkeit = () => {
    const onb = e.kategorie.value === "onboarding" && !fest;
    const papier = e.kategorie.value === "dienstzettel_papier";
    form.querySelectorAll("[data-nur=onboarding]").forEach((x) => { x.hidden = !onb; });
    form.querySelectorAll("[data-nicht=onboarding]").forEach((x) => { x.hidden = onb || papier; });
  };
  e.kategorie.addEventListener("change", sichtbarkeit);
  sichtbarkeit();
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });

  let offen = null;  // hochgeladen, aber noch nicht eingetragen: { pfad, hash, parameter }
  const eintragen = async () => {
    try {
      if (offen.papier) {
        await api.funktion("dienstzettel_papier", { p_pfad: offen.pfad, p_hash: offen.hash, p_dienstverhaeltnis_id: kopf.dienstverhaeltnis_id });
      } else {
        await api.funktion("dokument_ablegen", { p_pfad: offen.pfad, p_hash: offen.hash, ...offen.parameter });
      }
      bereich.innerHTML = "";
      await fertig();
    } catch (fehler) {
      meldung(`Die Datei ist hochgeladen, aber noch nicht eingetragen: ${fehler.message}`);
      form.querySelector("[data-aktion=erneut]").hidden = false;
    }
  };
  form.querySelector("[data-aktion=erneut]").addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    meldung("");
    await eintragen();
    ev.target.disabled = false;
  });

  form.querySelector("[data-aktion=vermerk]")?.addEventListener("click", async () => {
    if (!e.unterlage.value) return meldung("Bitte die Unterlage wählen.");
    vermerkZeigen(form, e.unterlage.value, kopf, bereich, fertig);
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    meldung("");
    const papier = e.kategorie.value === "dienstzettel_papier";
    const kategorie = papier ? "vereinbarung" : e.kategorie.value;
    const datei = e.datei.files[0];
    const onb = kategorie === "onboarding" && !fest;
    const unterlage = onb ? checkliste.find((u) => u.unterlage_id === e.unterlage.value) : null;
    if (onb && !unterlage) return meldung("Bitte die Unterlage wählen.");
    const bezeichnung = fest ? null : onb ? unterlage.bezeichnung : papier ? "Dienstzettel (Papier)" : e.bezeichnung.value.trim();
    if (!fest && !bezeichnung) return meldung("Bitte eine Bezeichnung angeben.");
    if (!datei) return meldung("Bitte eine Datei wählen.");
    const problem = dateiPruefen(datei);
    if (problem) return meldung(problem);

    const knopf = form.querySelector("button[type=submit]");
    knopf.disabled = true;
    try {
      const pfad = dateiPfad(stand.profil.organisation_id, kopf.dienstverhaeltnis_id, kategorie, datei.type);
      await api.hochladen(pfad, datei);
      offen = { pfad, hash: await sha256(datei), papier, parameter: {
        p_kategorie: kategorie, p_bezeichnung: bezeichnung, p_dienstverhaeltnis_id: kopf.dienstverhaeltnis_id,
        p_dokument_id: vorgabe.dokumentId || null,
        p_onboarding_unterlage_id: onb ? unterlage.unterlage_id : null,
        p_onboarding_ergebnis: onb ? e.ergebnis.value : null } };
      knopf.hidden = true;
      await eintragen();
    } catch (fehler) {
      meldung(fehler.message);
      knopf.disabled = false;
    }
  });
}

// Ablehnung ohne Datei (nur Büro): Vermerk eintragen
function vermerkZeigen(form, unterlageId, kopf, bereich, fertig) {
  const box = document.createElement("div");
  box.className = "reihe";
  box.innerHTML = `<label class="feld breit"><span>Vermerk (z. B. „mündlich abgelehnt am …“)</span>
    <input type="text" name="vermerk" maxlength="200"></label>
    <button type="button" class="knopf knopf-haupt" data-aktion="vermerk-speichern">Ablehnung vermerken</button>`;
  form.querySelector("[data-aktion=vermerk]").closest("p").replaceWith(box);
  box.querySelector("[data-aktion=vermerk-speichern]").addEventListener("click", async () => {
    const vermerk = box.querySelector("[name=vermerk]").value.trim();
    if (!vermerk) { form.querySelector(".fehler").textContent = "Bitte einen Vermerk angeben."; return; }
    try {
      await api.funktion("onboarding_vermerken", { p_dienstverhaeltnis_id: kopf.dienstverhaeltnis_id,
        p_unterlage_id: unterlageId, p_vermerk: vermerk });
      bereich.innerHTML = "";
      await fertig();
    } catch (fehler) {
      form.querySelector(".fehler").textContent = fehler.message;
    }
  });
}

// Klärung mit der Geschäftsführung schließen (nur Büro, mit Vermerk der Entscheidung)
async function klaerungZeigen(bereich, dv, unterlageId, fertig) {
  const [kl] = await api.lesen("onboarding_klaerung",
    `select=id&dienstverhaeltnis_id=eq.${dv}&onboarding_unterlage_id=eq.${unterlageId}&geschlossen_am=is.null`);
  if (!kl) return;
  bereich.innerHTML = `
    <form class="dialog" id="klaerung-form" novalidate>
      <h3>Klärung schließen</h3>
      <label class="feld"><span>Entscheidung der Geschäftsführung</span><input type="text" name="vermerk" maxlength="200"></label>
      <p class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="submit" class="knopf knopf-haupt">Klärung schließen</button>
        <button type="button" class="knopf knopf-leise" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $("#klaerung-form");
  form.querySelector("[data-aktion=abbrechen]").addEventListener("click", () => { bereich.innerHTML = ""; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const vermerk = form.elements.vermerk.value.trim();
    if (!vermerk) { form.querySelector(".fehler").textContent = "Bitte einen Vermerk angeben."; return; }
    try {
      await api.funktion("klaerung_schliessen", { p_klaerung_id: kl.id, p_vermerk: vermerk });
      bereich.innerHTML = "";
      await fertig();
    } catch (f) {
      form.querySelector(".fehler").textContent = f.message;
    }
  });
  form.elements.vermerk.focus();
}
