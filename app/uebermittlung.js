// Bereich „An Lohnverrechner übermitteln“ (Offene Punkte, nur Personalbüro).
// Je Lohnverrechner: Fälle anhaken, PDFs speichern, Mailprogramm öffnen, danach „Gesendet?“.
// Die App verschickt nie selbst. Vermerkt wird erst nach „Ja, gesendet“.
import * as api from "./api.js";
import { heuteIso } from "./pruefungen.js";
import { $, text, datum } from "./hilfen.js";
import { dateiname, mailLink } from "./sammelmail.js";

const ART = { anmeldung: "Anmeldung", abmeldung: "Abmeldung", storno: "Storno", korrektur: "Korrektur" };
export const ORT = "Gespeichert im Ordner Downloads (am iPad: Dateien-App → Downloads):";
const OHNE_MAIL = "Für diesen Lohnverrechner ist keine E-Mail-Adresse hinterlegt (Einstellungen).";

let faelle = [];

// Mailprogramm öffnen. Tests ersetzen das über window.__mailOeffnen, damit kein echtes Mailprogramm startet.
const mailOeffnen = (link) => (window.__mailOeffnen || ((l) => { location.href = l; }))(link);

export async function uebermittlungZeigen(bereich) {
  bereich.hidden = false;
  const liste = $("#uebermittlung-liste", bereich);
  liste.innerHTML = '<p class="leer-zustand">Wird geladen …</p>';
  try {
    faelle = await api.funktion("uebermittlung_offen") || [];
  } catch (f) {
    faelle = [];
    liste.innerHTML = `<p class="fehler">Die Liste konnte nicht geladen werden: ${text(f.message)}</p>`;
    return;
  }
  zeichnen(bereich);
  bereich.onclick = (e) => klick(e, bereich);
  bereich.onchange = (e) => { if (e.target.matches("input[type=checkbox]")) knoepfeSetzen(bereich); };
}

const lvSchluessel = (f) => f.lohnverrechner_id || "ohne";

function zeichnen(bereich) {
  const gruppen = new Map();
  for (const f of faelle) {
    const s = lvSchluessel(f);
    if (!gruppen.has(s)) gruppen.set(s, { id: s, name: f.lohnverrechner_name, email: f.lohnverrechner_email, faelle: [] });
    gruppen.get(s).faelle.push(f);
  }
  $("#uebermittlung-liste", bereich).innerHTML = gruppen.size ? [...gruppen.values()].map((g) => `
    <section class="lv-bereich akte-block" data-lv="${text(g.id)}">
      <h3>${text(g.name)} <small>${text(g.email || "")}</small></h3>
      <div class="tabelle-rahmen"><table class="tabelle"><tbody>${g.faelle.map((f) => `<tr>
        <td class="knopf-zelle">${f.dokument_id
          ? `<input type="checkbox" value="${text(f.dokument_id)}" checked aria-label="${text(`${ART[f.art]} ${f.nachname} ${f.vorname}`)} übermitteln">`
          : `<button type="button" class="knopf knopf-leise" data-erzeugen="${text(f.meldung_id)}">PDF erzeugen</button>`}</td>
        <td>${text(ART[f.art] || f.art)}</td>
        <td><a href="#akte/${text(f.dienstverhaeltnis_id)}/dokumente">${text(`${f.nachname} ${f.vorname}`)}</a>
          <span class="zeile-unter">${text(f.gesellschaft)}</span></td>
        <td>${text(datum(f.datum))}</td></tr>`).join("")}</tbody></table></div>
      ${g.email ? "" : `<p class="einleitung klein">${text(OHNE_MAIL)}</p>`}
      <div class="knopf-reihe"><button type="button" class="knopf knopf-haupt" data-aktion="senden">PDFs speichern und Mail öffnen</button></div>
    </section>`).join("") : '<p class="leer-zustand">Nichts zu übermitteln.</p>';
  knoepfeSetzen(bereich);
}

function knoepfeSetzen(bereich) {
  bereich.querySelectorAll(".lv-bereich").forEach((s) => {
    const g = faelle.find((f) => lvSchluessel(f) === s.dataset.lv);
    s.querySelector("[data-aktion=senden]").disabled = !g?.lohnverrechner_email || !s.querySelector("input[type=checkbox]:checked");
  });
}

const status = (bereich, t, fehler = false) => {
  const el = $("#uebermittlung-status", bereich);
  el.textContent = t;
  el.classList.toggle("fehler", fehler);
};

async function klick(e, bereich) {
  const k = e.target.closest("button");
  if (!k || k.disabled) return;
  if (k.dataset.erzeugen) {
    k.disabled = true;
    try {
      await api.mappe("meldung", { meldung_id: k.dataset.erzeugen });
      status(bereich, "PDF erzeugt.");
      return uebermittlungZeigen(bereich);
    } catch (f) {
      k.disabled = false;
      return status(bereich, `Das PDF konnte nicht erstellt werden: ${f.message}`, true);
    }
  }
  if (k.dataset.aktion === "senden") return senden(k.closest(".lv-bereich"), bereich, k);
}

// Datei über einen kurzen Link holen und unter dem gewünschten Namen speichern
async function speichern(pfad, name) {
  const antwort = await fetch(await api.dateiLink(pfad, true));
  if (!antwort.ok) throw new Error(`${name} konnte nicht geladen werden.`);
  const url = URL.createObjectURL(await antwort.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function senden(abschnitt, bereich, knopf) {
  const ids = [...abschnitt.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
  const auswahl = faelle.filter((f) => ids.includes(f.dokument_id));
  if (!auswahl.length) return;
  const heute = heuteIso();
  const dialog = $("#uebermittlung-dialog", bereich);
  knopf.disabled = true;
  status(bereich, "PDFs werden gespeichert …");
  const namen = [];
  try {
    const pfade = new Map((await api.lesen("dokument", `select=id,datei_pfad&id=in.(${ids.join(",")})`)).map((d) => [d.id, d.datei_pfad]));
    for (const f of auswahl) {
      let name = dateiname({ datum: heute, lohnverrechner: f.lohnverrechner_name, art: f.art, nachname: f.nachname, vorname: f.vorname });
      // gleicher Name, gleiche Art, gleicher Tag: sonst hängt der Browser „(1)“ an und die Liste stimmt nicht
      for (let i = 2; namen.includes(name); i++) name = name.replace(/(-\d+)?\.pdf$/, `-${i}.pdf`);
      if (!pfade.get(f.dokument_id)) throw new Error(`Für ${f.nachname} ${f.vorname} fehlt das PDF.`);
      await speichern(pfade.get(f.dokument_id), name);
      namen.push(name);
    }
  } catch (f) {
    knopf.disabled = false;
    return status(bereich, `Speichern hat nicht geklappt: ${f.message}`, true);
  }
  status(bereich, "");
  const link = mailLink({ an: auswahl[0].lohnverrechner_email, faelle: auswahl, datum: heute });
  dialog.innerHTML = `
    <div class="dialog" role="dialog" aria-labelledby="t-gesendet">
      <p>${text(ORT)}</p>
      <ul class="gespeichert-liste">${namen.map((n) => `<li><code>${text(n)}</code></li>`).join("")}</ul>
      <p class="einleitung klein">Das Mailprogramm öffnet sich mit Empfänger, Betreff und Text. Bitte die Dateien anhängen und selbst senden.
        <a href="${text(link)}">Mail noch einmal öffnen</a></p>
      <h3 id="t-gesendet">Gesendet?</h3>
      <div class="knopf-reihe">
        <button type="button" class="knopf knopf-haupt" id="gesendet-ja">Ja, gesendet</button>
        <button type="button" class="knopf knopf-leise" id="gesendet-nein">Nein, noch nicht</button>
      </div>
    </div>`;
  mailOeffnen(link);
  dialog.scrollIntoView?.({ block: "nearest" });
  $("#gesendet-nein", dialog).onclick = () => {
    dialog.innerHTML = "";
    knopf.disabled = false;
    status(bereich, "Nichts vermerkt. Die Fälle bleiben auf der Liste.");
  };
  $("#gesendet-ja", dialog).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const ergebnis = await api.funktion("uebermittlung_vermerken", { p_dokument_ids: ids }) || [];
      const n = ergebnis.reduce((s, x) => s + Number(x.vermerkt || 0), 0);
      dialog.innerHTML = "";
      await uebermittlungZeigen(bereich);
      status(bereich, `${n} ${n === 1 ? "Fall" : "Fälle"} als übermittelt vermerkt.`);
    } catch (f) {
      ev.target.disabled = false;
      status(bereich, `Nicht vermerkt: ${f.message}`, true);
    }
  };
}
