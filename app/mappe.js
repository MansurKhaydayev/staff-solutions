// Seite „Unterschriftsmappe“ (#mappe/<Dienstverhältnis>): Der neue Mitarbeiter unterschreibt am iPad
// zuerst den Dienstzettel, dann die Onboarding-Unterlagen. Das PDF erzeugt die Edge Function.
import * as api from "./api.js";
import { $, text, datum } from "./hilfen.js";
import { heuteWien } from "./frist.js";
import { unterschriftsFeld } from "./unterschrift.js";

let lauf = 0;  // verhindert, dass eine ältere Antwort eine neuere Ansicht überschreibt

const ziel = () => $("#mappe-inhalt");

export async function mappeZeigen(stand, dvId) {
  const meinLauf = ++lauf;
  ziel().innerHTML = '<p class="leer-zustand">Mappe wird geladen …</p>';
  let m;
  try {
    m = await api.funktion("mappe_inhalt", { p_dienstverhaeltnis_id: dvId });
  } catch (fehler) {
    if (meinLauf !== lauf) return;
    ziel().innerHTML = `<p class="fehler">Die Mappe konnte nicht geladen werden: ${text(fehler.message)}</p>
      <p><a href="#mitarbeiter">Zur Mitarbeiterliste</a></p>`;
    return;
  }
  if (meinLauf !== lauf) return;
  const offen = m.schritte.findIndex((s) => s.status === "offen");
  if (offen < 0) fertigZeigen(m, dvId);
  else schrittZeigen(stand, m, offen, dvId);
}

const TITEL = { dienstzettel: "Dienstzettel", onboarding: "Onboarding" };
const STATUS = { unterschrieben: "unterschrieben", abgeschlossen: "erledigt", abgelehnt: "abgelehnt", offen: "offen" };

function fortschritt(m, aktuell) {
  return `<ol class="mappe-fortschritt">${m.schritte.map((s, i) => {
    const name = s.inhalt?.titel || s.titel || TITEL[s.art];
    const zustand = i === aktuell ? "aktuell" : s.status === "offen" ? "offen" : s.status === "abgelehnt" ? "abgelehnt" : "erledigt";
    return `<li class="${zustand}"${i === aktuell ? ' aria-current="step"' : ""}>${text(name === "DIENSTZETTEL" ? "Dienstzettel" : name)}
      <small>${text(i === aktuell ? "jetzt" : STATUS[s.status] || s.status)}</small></li>`;
  }).join("")}</ol>`;
}

function blatt(inhalt) {
  return `<article id="mappe-blatt" class="mappe-blatt">
    <p class="mappe-firma">${text(inhalt.kopf?.firma)}<br><span>${text(inhalt.kopf?.adresse)}</span></p>
    <h2>${text(inhalt.titel)}</h2>
    ${inhalt.untertitel ? `<p class="mappe-untertitel">${text(inhalt.untertitel)}</p>` : ""}
    ${(inhalt.felder || []).length ? `<dl class="mappe-felder">${inhalt.felder.map(([b, w]) =>
      `<div><dt>${text(b)}</dt><dd>${text(w)}</dd></div>`).join("")}</dl>` : ""}
    ${(inhalt.abschnitte || []).map((a) => `<section>${a.titel ? `<h3>${text(a.titel)}</h3>` : ""}
      ${String(a.text ?? "").split("\n").map((z) => `<p>${text(z)}</p>`).join("")}</section>`).join("")}
  </article>`;
}

function schrittZeigen(stand, m, index, dvId) {
  const s = m.schritte[index];
  const onboarding = s.art === "onboarding";
  const zeile = (s.inhalt?.unterschrift_zeilen || []).find((z) => z.rolle === "mitarbeiter");
  const fristOffen = s.art === "dienstzettel" && m.frist?.verletzt;
  ziel().innerHTML = `
    <header class="mappe-kopf">
      <h1 class="seitentitel">Unterschriftsmappe: ${text(m.name)}</h1>
      <p class="mappe-schritt">Schritt ${index + 1} von ${m.schritte.length}</p>
      ${fortschritt(m, index)}
    </header>
    ${blatt(s.inhalt)}
    <section class="mappe-unterschrift" aria-label="Unterschrift">
      <label class="ankreuzen"><input type="checkbox" id="mappe-gelesen"> Ich habe den Text gelesen und bin einverstanden.</label>
      <p class="mappe-ort">${text(m.ort)}, ${text(datum(heuteWien()))}</p>
      <div id="unterschrift-feld" class="unterschrift-feld"></div>
      <div class="unterschrift-unter">
        <span>${text(zeile?.beschriftung || "Unterschrift")}</span>
        <button type="button" class="knopf knopf-leise" id="unterschrift-loeschen">Unterschrift löschen</button>
      </div>
      <p id="unterschrift-hinweis" class="hinweis" hidden>Die Bildschirmgröße hat sich geändert. Bitte erneut unterschreiben.</p>
      <div id="mappe-dringend" class="mappe-dringend"${fristOffen ? "" : " hidden"}>
        <label class="feld"><span>Grund für die dringende Anmeldung</span><textarea rows="2" maxlength="300"></textarea></label>
        <p class="hinweis">Der Dienstantritt liegt vor dem frühesten Termin. Mit dem Grund übernimmst du die Verantwortung,
          dass die Anmeldung rechtzeitig erledigt wird. Das Personalbüro sieht den Grund.</p>
      </div>
      <p id="mappe-meldung" class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="button" class="knopf knopf-haupt" id="mappe-unterschreiben">Unterschreiben</button>
        <button type="button" class="knopf knopf-leise" id="mappe-ablehnen"${onboarding ? "" : " hidden"}>Lehnt ab</button>
        <span id="mappe-ablehnen-frage" class="mappe-frage" hidden>Wirklich ablehnen?
          <button type="button" class="knopf" id="mappe-ablehnen-ja">Ja, lehnt ab</button></span>
        <a href="#akte/${text(dvId)}/dokumente" class="knopf knopf-leise">Später fortsetzen</a>
      </div>
    </section>`;

  const hinweis = $("#unterschrift-hinweis");
  const feld = unterschriftsFeld($("#unterschrift-feld"), { beiGroessenwechsel: () => { hinweis.hidden = false; } });
  const meldung = (t) => { $("#mappe-meldung").textContent = t; };
  const dringend = $("#mappe-dringend");
  const knoepfe = () => ziel().querySelectorAll("#mappe-unterschreiben, #mappe-ablehnen, #mappe-ablehnen-ja");
  let sendet = false;

  $("#unterschrift-loeschen").addEventListener("click", () => { feld.loeschen(); hinweis.hidden = true; });
  $("#unterschrift-feld").addEventListener("pointerdown", () => { hinweis.hidden = true; meldung(""); });

  async function senden(ergebnis) {
    sendet = true;
    knoepfe().forEach((k) => { k.disabled = true; });
    const knopf = $("#mappe-unterschreiben");
    const vorher = knopf.textContent;
    knopf.textContent = "Wird abgelegt …";
    meldung("");
    try {
      const daten = { dienstverhaeltnis_id: dvId, art: s.art, fassung: s.fassung, ergebnis };
      if (onboarding) daten.unterlage_id = s.unterlage_id;
      if (ergebnis === "unterschrieben") daten.png_base64 = await base64(await feld.png());
      const grund = dringend.hidden ? "" : dringend.querySelector("textarea").value.trim();
      if (grund) daten.dringend_grund = grund;
      await api.mappe("mitarbeiter", daten);
      await mappeZeigen(stand, dvId);
    } catch (fehler) {
      if (fehler.frist) {
        dringend.hidden = false;
        dringend.querySelector("textarea").focus();
      }
      meldung(fehler.message);
      knoepfe().forEach((k) => { k.disabled = false; });
      knopf.textContent = vorher;
      sendet = false;
    }
  }

  $("#mappe-unterschreiben").addEventListener("click", () => {
    if (sendet) return;
    if (!$("#mappe-gelesen").checked) return meldung("Bitte bestätigen, dass der Text gelesen wurde.");
    if (feld.leer()) return meldung("Bitte unterschreiben.");
    if (!dringend.hidden && !dringend.querySelector("textarea").value.trim()) {
      return meldung("Bitte einen Grund für die dringende Anmeldung angeben.");
    }
    senden("unterschrieben");
  });
  $("#mappe-ablehnen").addEventListener("click", () => { $("#mappe-ablehnen-frage").hidden = false; });
  $("#mappe-ablehnen-ja").addEventListener("click", () => { if (!sendet) senden("abgelehnt"); });
}

function fertigZeigen(m, dvId) {
  const abgelehnt = m.schritte.filter((s) => s.status === "abgelehnt");
  ziel().innerHTML = `
    <section id="mappe-fertig" class="mappe-fertig">
      <h1 class="seitentitel">Unterschriftsmappe: ${text(m.name)}</h1>
      ${fortschritt(m, -1)}
      <p class="mappe-ergebnis">Fertig. Alle Unterlagen sind abgelegt.</p>
      ${abgelehnt.length ? `<p class="hinweis">Abgelehnt: ${abgelehnt.map((s) => text(s.titel || s.inhalt?.titel || "Unterlage")).join(", ")}.
        Das Personalbüro klärt das mit der Geschäftsführung.</p>` : ""}
      <p><a href="#akte/${text(dvId)}/dokumente" class="knopf knopf-haupt">Zur Akte</a></p>
    </section>`;
}

function base64(blob) {
  return new Promise((ok, nein) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = () => nein(new Error("Die Unterschrift konnte nicht gelesen werden."));
    r.readAsDataURL(blob);
  });
}
