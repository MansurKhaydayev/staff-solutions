// Seite „Zu unterschreiben“ (#unterschreiben): Geschäftsführung unterschreibt Dienstzettel als Arbeitgeber.
// Sichtbar nur mit dem Recht „Arbeitgeber-Unterschrift“ (prüft auch die Datenbank).
import * as api from "./api.js";
import { $, text, datum } from "./hilfen.js";
import { heuteWien } from "./frist.js";
import { blatt, base64 } from "./mappe.js";
import { unterschriftsFeld } from "./unterschrift.js";

let eintraege = [];
let eingerichtet = false;

export async function arbeitgeberZeigen() {
  if (!eingerichtet) {
    // onclick statt addEventListener: die Liste bleibt bestehen, Handler sollen sich nicht stapeln
    $("#ag-liste").onclick = klick;
    eingerichtet = true;
  }
  $("#ag-leer").hidden = true;
  $("#ag-liste").innerHTML = '<li class="leer-zustand">Wird geladen …</li>';
  try {
    eintraege = await api.funktion("arbeitgeber_offen");
  } catch (fehler) {
    eintraege = [];
    $("#ag-liste").innerHTML = `<li class="fehler">Die Liste konnte nicht geladen werden: ${text(fehler.message)}</li>`;
    return;
  }
  zeichnen();
}

function zeichnen() {
  $("#ag-leer").hidden = eintraege.length > 0;
  $("#ag-liste").innerHTML = eintraege.map((e) => `
    <li class="ag-eintrag${e.dringend_grund ? " dringend" : ""}" data-dok="${text(e.dokument_id)}">
      <div class="ag-zeile">
        <div>
          <strong>${text(`${e.nachname} ${e.vorname}`)}</strong>
          ${e.dringend_grund ? '<span class="merkmal merkmal-fehlt">Dringend</span>' : ""}
          <div class="ag-unterzeile">${text(e.arbeitsort)} · Dienstantritt ${text(datum(e.eintritt))}
            · vom Mitarbeiter unterschrieben am ${text(datum(e.unterschrieben_am))}</div>
          ${e.dringend_grund ? `<div class="ag-grund">Grund: ${text(e.dringend_grund)}</div>` : ""}
        </div>
        <div class="knopf-reihe">
          <button type="button" class="knopf knopf-leise" data-ansehen="${text(e.dokument_id)}">Ansehen</button>
          <button type="button" class="knopf knopf-haupt" data-unterschreiben="${text(e.dokument_id)}">Unterschreiben</button>
        </div>
      </div>
    </li>`).join("");
}

async function klick(ev) {
  const k = ev.target.closest("button");
  if (!k) return;
  const e = eintraege.find((x) => x.dokument_id === (k.dataset.ansehen || k.dataset.unterschreiben));
  if (k.dataset.ansehen && e) return ansehen(k, e.pdf_pfad);
  if (k.dataset.unterschreiben && e) return unterschreibenOeffnen(k.closest("li"), e);
}

// Den Tab sofort öffnen (Safari am iPad blockiert sonst das Fenster), dann die Adresse setzen
async function ansehen(knopf, pfad) {
  const fenster = window.open("", "_blank");
  knopf.disabled = true;
  try {
    const url = await api.dateiLink(pfad);
    if (fenster) { fenster.opener = null; fenster.location.href = url; } else { location.href = url; }
  } catch (fehler) {
    fenster?.close();
    $("#ag-status").textContent = `Datei konnte nicht geöffnet werden: ${fehler.message}`;
  } finally {
    knopf.disabled = false;
  }
}

async function unterschreibenOeffnen(li, e) {
  document.querySelector("#ag-bereich")?.remove();   // immer nur ein Dienstzettel offen
  const bereich = document.createElement("div");
  bereich.id = "ag-bereich";
  bereich.className = "ag-bereich";
  bereich.innerHTML = '<p class="leer-zustand">Dienstzettel wird geladen …</p>';
  li.append(bereich);
  let a;
  try {
    a = await api.funktion("arbeitgeber_inhalt", { p_dokument_id: e.dokument_id });
  } catch (fehler) {
    bereich.innerHTML = `<p class="fehler">${text(fehler.message)}</p>`;
    return;
  }
  bereich.innerHTML = `
    ${blatt(a.inhalt)}
    <section class="mappe-unterschrift" aria-label="Arbeitgeber-Unterschrift">
      <label class="ankreuzen"><input type="checkbox" id="ag-geprueft"> Ich habe den Dienstzettel geprüft.</label>
      <p class="mappe-ort">${text(a.arbeitgeber_ort || "")}, ${text(datum(heuteWien()))}</p>
      <div id="unterschrift-feld" class="unterschrift-feld"></div>
      <div class="unterschrift-unter"><span>Arbeitgeber</span>
        <button type="button" class="knopf knopf-leise" id="ag-loeschen">Unterschrift löschen</button></div>
      <p id="unterschrift-hinweis" class="hinweis" hidden>Die Bildschirmgröße hat sich geändert. Bitte erneut unterschreiben.</p>
      <p id="ag-meldung" class="fehler" role="alert"></p>
      <div class="knopf-reihe">
        <button type="button" class="knopf knopf-haupt" id="ag-unterschreiben">Als Arbeitgeber unterschreiben</button>
        <button type="button" class="knopf knopf-leise" id="ag-abbrechen">Abbrechen</button>
      </div>
    </section>`;
  const hinweis = bereich.querySelector("#unterschrift-hinweis");
  const feld = unterschriftsFeld(bereich.querySelector("#unterschrift-feld"), { beiGroessenwechsel: () => { hinweis.hidden = false; } });
  const meldung = (t) => { bereich.querySelector("#ag-meldung").textContent = t; };
  bereich.querySelector("#ag-loeschen").addEventListener("click", () => { feld.loeschen(); hinweis.hidden = true; });
  bereich.querySelector("#ag-abbrechen").addEventListener("click", () => bereich.remove());
  bereich.querySelector("#unterschrift-feld").addEventListener("pointerdown", () => { hinweis.hidden = true; meldung(""); });

  let sendet = false;
  const knopf = bereich.querySelector("#ag-unterschreiben");
  knopf.addEventListener("click", async () => {
    if (sendet) return;
    if (!bereich.querySelector("#ag-geprueft").checked) return meldung("Bitte bestätigen, dass du den Dienstzettel geprüft hast.");
    if (feld.leer()) return meldung("Bitte unterschreiben.");
    sendet = true;
    knopf.disabled = true;
    knopf.textContent = "Wird abgelegt …";
    meldung("");
    try {
      await api.mappe("arbeitgeber", { dokument_id: e.dokument_id, fassung: a.fassung, png_base64: await base64(await feld.png()) });
      $("#ag-status").textContent = `Unterschrieben: Dienstzettel ${e.nachname} ${e.vorname}.`;
      await arbeitgeberZeigen();
    } catch (fehler) {
      meldung(fehler.message);
      knopf.disabled = false;
      knopf.textContent = "Als Arbeitgeber unterschreiben";
      sendet = false;
    }
  });
}
