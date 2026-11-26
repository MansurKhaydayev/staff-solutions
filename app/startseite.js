// Startseite: Personalzahlen auf einen Blick (Monat, Jahr, Personal heute, was bald ansteht).
// Die Daten kommen aus mitarbeiter_verzeichnis. Die Datenbank liefert jeder Rolle nur,
// was sie sehen darf; Zahlen mit Geld werden nur mit dem Recht „Entgelt“ geladen.
import * as api from "./api.js";
import { $, text, datum, ART } from "./hilfen.js";
import * as k from "./kennzahlen.js";

export const MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
  "September", "Oktober", "November", "Dezember"];
const KURZ = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const zahl = (n, stellen = 0) => (n === null || n === undefined ? "–"
  : Number(n).toLocaleString("de-AT", { minimumFractionDigits: stellen, maximumFractionDigits: stellen }));
const prozent = (n) => (n === null || n === undefined ? "–" : `${zahl(n, 1)} %`);

let geladen = null;     // { zeilen, entgelt, offen, unterschreiben }
let auswahl = null;     // { jahr, monat, standort }

// ------------------------------------------------------------------ Laden

export async function startseiteZeigen(stand, { offenePunkte = false } = {}) {
  const seite = $("#seite-start");
  const heute = k.heuteWien();
  const [jahr, monat] = heute.split("-").map(Number);
  auswahl ||= { jahr, monat, standort: "" };
  $("#start-inhalt").innerHTML = '<p class="start-laden">Zahlen werden geladen …</p>';
  try {
    const [verzeichnis, status, entgelt, offen, unterschreiben] = await Promise.all([
      api.funktion("mitarbeiter_verzeichnis"),
      // Status (z. B. „nicht angetreten“) aus dem Austritt-Modul; fehlt er, zählt alles wie bisher
      api.funktion("mitarbeiter_status").catch(() => null),
      stand.recht.sieht_entgelt
        ? api.lesen("entgelt", "select=dienstverhaeltnis_id,brutto,gueltig_ab,storniert_am") : Promise.resolve(null),
      offenePunkte ? api.funktion("offene_punkte").catch(() => null) : Promise.resolve(null),
      stand.recht.darf_arbeitgeber_unterschreiben
        ? api.funktion("arbeitgeber_offen").catch(() => null) : Promise.resolve(null),
    ]);
    geladen = { zeilen: k.mitStatus(verzeichnis, status), entgelt, offen, unterschreiben };
  } catch (fehler) {
    $("#start-inhalt").innerHTML = `<p class="fehler" role="alert">Die Zahlen konnten nicht geladen werden: ${text(fehler.message)}</p>`;
    return;
  }
  steuerungFuellen(stand, heute);
  knopfZeigen(stand);
  if (!seite.dataset.verbunden) {
    seite.dataset.verbunden = "1";
    $("#start-steuerung").addEventListener("change", (e) => {
      if (e.target.name === "arbeitsort") auswahl.standort = e.target.value;
      else auswahl[e.target.name] = Number(e.target.value);
      if (e.target.name === "jahr") {
        const [jetztJahr, jetztMonat] = k.heuteWien().split("-").map(Number);
        const letzter = auswahl.jahr === jetztJahr ? jetztMonat : 12;
        auswahl.monat = Math.min(auswahl.monat, letzter);
      }
      steuerungFuellen(stand, k.heuteWien());
      zeichnen(stand, k.heuteWien());
    });
    $("#start-pdf").addEventListener("click", herunterladen);
  }
  zeichnen(stand, heute);
}

// Jahr, Monat und Arbeitsort zur Auswahl
function steuerungFuellen(stand, heute) {
  const [jahrHeute, monatHeute] = heute.split("-").map(Number);
  const ersteJahr = Math.min(jahrHeute, ...geladen.zeilen.map((z) => Number(z.eintritt.slice(0, 4))));
  const jahre = [];
  for (let j = jahrHeute; j >= Math.max(ersteJahr, jahrHeute - 9); j--) jahre.push(j);
  const f = $("#start-steuerung").elements;
  f.jahr.innerHTML = jahre.map((j) => `<option value="${j}">${j}</option>`).join("");
  f.jahr.value = auswahl.jahr;
  const letzter = auswahl.jahr === jahrHeute ? monatHeute : 12;
  f.monat.innerHTML = MONATE.slice(0, letzter).map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  f.monat.value = auswahl.monat;

  const sichtbar = new Set(geladen.zeilen.map((z) => z.standort_id));
  const orte = stand.standorte.filter((s) => sichtbar.has(s.id));
  f.arbeitsort.innerHTML = `<option value="">Alle Arbeitsorte${orte.length > 1 ? ` (${orte.length})` : ""}</option>` +
    orte.map((s) => `<option value="${s.id}">${text(s.name)}</option>`).join("");
  if (!orte.some((s) => s.id === auswahl.standort)) auswahl.standort = "";
  f.arbeitsort.value = auswahl.standort;
  f.arbeitsort.closest("label").hidden = orte.length < 2;
}

// ------------------------------------------------------------------ Zeichnen

function zeichnen(stand, heute) {
  const alle = k.zaehlbar(geladen.zeilen);
  const zeilen = auswahl.standort ? alle.filter((z) => z.standort_id === auswahl.standort) : alle;
  const { jahr, monat } = auswahl;
  const probezeit = stand.organisation?.probezeit_monate ?? 1;
  const m = k.monatsZahlen(zeilen, jahr, monat, heute);
  const vor = k.monatPlus(jahr, monat, -1);
  const vm = k.monatsZahlen(zeilen, vor.jahr, vor.monat, heute);
  const zwoelf = k.zwoelfMonate(zeilen, jahr, monat, heute);
  const frueh12 = k.fruehfluktuation(zeilen, probezeit, zwoelf.von, zwoelf.bis);
  const j = k.jahresZahlen(zeilen, jahr, heute);
  const fruehJahr = k.fruehfluktuation(zeilen, probezeit, j.von, j.bis);

  const ortName = auswahl.standort ? stand.standorte.find((s) => s.id === auswahl.standort)?.name : "alle Arbeitsorte";
  $("#start-untertitel").textContent =
    `${stand.organisation?.name || ""} · ${ortName} · Stand ${datum(heute)}`.replace(/^ · /, "");

  const ohneAustritte = !geladen.zeilen.some((z) => z.austritt);
  $("#start-inhalt").innerHTML = [
    ohneAustritte ? `<p class="start-hinweis" role="note"><strong>Hinweis:</strong> Austritte kann die App noch nicht
      erfassen. Austritte, Fluktuation und Frühfluktuation zeigen deshalb 0 bzw. „–“, bis das Austritt-Modul fertig ist.</p>` : "",
    teilMonat(m, vm, zwoelf, frueh12),
    teilJahr(j, fruehJahr, monat),
    teilHeute(stand, zeilen, heute),
    teilAchtung(stand, zeilen, heute, probezeit),
  ].join("");
}

const kachel = (titel, wert, zusatz = "", art = "") =>
  `<div class="kachel ${art}"><div class="kachel-titel">${text(titel)}</div>` +
  `<div class="kachel-wert">${wert}</div>${zusatz ? `<div class="kachel-zusatz">${zusatz}</div>` : ""}</div>`;

function vergleich(jetzt, vorher, laufend) {
  if (vorher === null || vorher === undefined) return "";
  const d = jetzt - vorher;
  const t = d === 0 ? "gleich wie im Vormonat" : `${d > 0 ? "+" : "−"}${zahl(Math.abs(d))} zum Vormonat`;
  return laufend ? `${t} (Monat läuft noch)` : t;
}

function teilMonat(m, vm, zwoelf, frueh) {
  const name = `${MONATE[m.monat - 1]} ${m.jahr}`;
  return `<section class="start-teil" aria-labelledby="t-monat">
    <h2 id="t-monat">${text(name)}${m.laufend ? ` <small>bis heute</small>` : ""}</h2>
    <div class="kacheln">
      ${kachel(m.laufend ? "Im Dienst heute" : "Stand am Monatsende", zahl(m.standEnde),
        `am Monatsanfang ${zahl(m.standAnfang)}`)}
      ${kachel("Eintritte", zahl(m.eintritte),
        [m.eintritteGeplant ? `dazu ${zahl(m.eintritteGeplant)} geplant` : "", vergleich(m.eintritte, vm.eintritte, m.laufend)]
          .filter(Boolean).join(" · "))}
      ${kachel("Austritte", zahl(m.austritte),
        [m.austritteGeplant ? `dazu ${zahl(m.austritteGeplant)} geplant` : "", vergleich(m.austritte, vm.austritte, m.laufend)]
          .filter(Boolean).join(" · "))}
      ${kachel("Fluktuation im Monat", prozent(m.fluktuation), `Vormonat ${prozent(vm.fluktuation)}`)}
      ${kachel("Fluktuation 12 Monate", prozent(zwoelf.fluktuation),
        `${zahl(zwoelf.austritte)} Austritte bei Ø ${zahl(zwoelf.durchschnitt, 1)} Personen`, "kachel-betont")}
      ${kachel("Frühfluktuation 12 Monate", prozent(frueh.anteil),
        frueh.austritte ? `${zahl(frueh.inProbezeit)} von ${zahl(frueh.austritte)} Austritten in der Probezeit` : "noch keine Austritte")}
    </div>
    <details class="start-erklaerung"><summary>Wie wird das gerechnet?</summary>
      <p><strong>Fluktuation</strong> = Austritte ÷ durchschnittlicher Personalstand × 100. Beim Monat ist der Durchschnitt
      (Stand am Anfang + Stand am Ende) ÷ 2, bei 12 Monaten der Durchschnitt der 12 Monatsend-Stände.
      Die 12 Monate reichen von ${datum(zwoelf.von)} bis ${datum(zwoelf.bis)}.</p>
      <p><strong>Frühfluktuation</strong> = Anteil der Austritte, bei denen der letzte Arbeitstag noch in der Probezeit lag.</p>
      <p>Gezählt wird nach dem Datum: Eintritt = erster Arbeitstag, Austritt = letzter Arbeitstag.</p>
    </details>
  </section>`;
}

function teilJahr(j, frueh, gewaehlt) {
  const zeilen = j.monate.map((m) => `<tr${m.monat === gewaehlt ? ' class="gewaehlt"' : ""}>
      <th scope="row">${MONATE[m.monat - 1]}${m.laufend ? " (bis heute)" : ""}</th>
      ${m.zukunft ? '<td colspan="4" class="leise">noch nicht erreicht</td>'
        : `<td>${zahl(m.eintritte)}</td><td>${zahl(m.austritte)}</td><td>${zahl(m.standEnde)}</td><td>${prozent(m.fluktuation)}</td>`}
    </tr>`).join("");
  return `<section class="start-teil" aria-labelledby="t-jahr">
    <h2 id="t-jahr">Jahresübersicht ${j.jahr}</h2>
    <div class="kacheln">
      ${kachel("Eintritte im Jahr", zahl(j.eintritte))}
      ${kachel("Austritte im Jahr", zahl(j.austritte))}
      ${kachel("Ø Personalstand", zahl(j.durchschnitt, 1), "Durchschnitt der Monatsend-Stände")}
      ${kachel("Fluktuation im Jahr", prozent(j.fluktuation), "", "kachel-betont")}
      ${kachel("Frühfluktuation im Jahr", prozent(frueh.anteil),
        frueh.austritte ? `${zahl(frueh.inProbezeit)} von ${zahl(frueh.austritte)} in der Probezeit` : "noch keine Austritte")}
    </div>
    <div class="diagramme">
      <figure class="karte diagramm">
        <figcaption>Eintritte und Austritte je Monat</figcaption>
        <div class="legende" aria-hidden="true"><span class="punkt punkt-ein"></span>Eintritte<span class="punkt punkt-aus"></span>Austritte</div>
        ${balkenDiagramm(j.monate, gewaehlt)}
      </figure>
      <figure class="karte diagramm">
        <figcaption>Personalstand am Monatsende</figcaption>
        ${linienDiagramm(j.monate, gewaehlt)}
      </figure>
    </div>
    <div class="karte tabelle-rahmen">
      <table class="start-tabelle">
        <caption>Monate im Detail</caption>
        <thead><tr><th scope="col">Monat</th><th scope="col">Eintritte</th><th scope="col">Austritte</th>
          <th scope="col">Stand Monatsende</th><th scope="col">Fluktuation</th></tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr><th scope="row">Jahr ${j.jahr}</th><td>${zahl(j.eintritte)}</td><td>${zahl(j.austritte)}</td>
          <td>Ø ${zahl(j.durchschnitt, 1)}</td><td>${prozent(j.fluktuation)}</td></tr></tfoot>
      </table>
    </div>
  </section>`;
}

// Säulen für Eintritte und Austritte. Die Zahlen stehen über den Säulen, damit sie auch im PDF lesbar sind.
export function balkenDiagramm(monate, gewaehlt) {
  const B = 720, H = 220, oben = 22, unten = 28, links = 8;
  const max = Math.max(1, ...monate.map((m) => Math.max(m.eintritte, m.austritte)));
  const band = (B - links * 2) / 12, breit = Math.min(18, band / 3);
  const y = (v) => oben + (H - oben - unten) * (1 - v / max);
  const fuss = H - unten;
  const saeule = (x, v, art, titel) => {
    if (v <= 0) return `<line x1="${x}" x2="${x + breit}" y1="${fuss}" y2="${fuss}" class="nullstrich"/>`;
    const h = fuss - y(v), r = Math.min(4, h);
    return `<path class="saeule ${art}" d="M${x},${fuss} V${y(v) + r} q0,-${r} ${r},-${r} H${x + breit - r} q${r},0 ${r},${r} V${fuss} Z"><title>${titel}</title></path>` +
      `<text class="wert" x="${x + breit / 2}" y="${y(v) - 6}" text-anchor="middle">${v}</text>`;
  };
  const teile = monate.map((m, i) => {
    const mitte = links + band * i + band / 2;
    const name = `${MONATE[m.monat - 1]} ${m.jahr}`;
    return (m.monat === gewaehlt ? `<rect class="markierung" x="${links + band * i + 2}" y="4" width="${band - 4}" height="${H - 8}" rx="8"/>` : "") +
      (m.zukunft ? "" : saeule(mitte - breit - 1, m.eintritte, "ein", `${name}: ${m.eintritte} Eintritte`) +
        saeule(mitte + 1, m.austritte, "aus", `${name}: ${m.austritte} Austritte`)) +
      `<text class="achse${m.zukunft ? " leise" : ""}" x="${mitte}" y="${H - 8}" text-anchor="middle">${KURZ[m.monat - 1]}</text>`;
  }).join("");
  const beschreibung = monate.filter((m) => !m.zukunft)
    .map((m) => `${KURZ[m.monat - 1]} ${m.eintritte} ein, ${m.austritte} aus`).join("; ");
  return `<svg viewBox="0 0 ${B} ${H}" role="img" aria-label="Eintritte und Austritte je Monat: ${text(beschreibung)}">
    <line class="grundlinie" x1="${links}" x2="${B - links}" y1="${fuss}" y2="${fuss}"/>${teile}</svg>`;
}

// Linie für den Personalstand. Die Achse beginnt bei 0, damit Schwankungen nicht größer wirken, als sie sind.
export function linienDiagramm(monate, gewaehlt) {
  const B = 720, H = 220, oben = 26, unten = 28, links = 8;
  const da = monate.filter((m) => !m.zukunft);
  const max = Math.max(1, ...da.map((m) => m.standEnde));
  const band = (B - links * 2) / 12;
  const x = (m) => links + band * (m.monat - 1) + band / 2;
  const y = (v) => oben + (H - oben - unten) * (1 - v / max);
  const linie = da.map((m, i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(m.standEnde).toFixed(1)}`).join(" ");
  const punkte = da.map((m) => {
    const zeigen = m.monat === gewaehlt || m === da[da.length - 1] || m === da[0];
    return `<circle class="punkt-stand" cx="${x(m)}" cy="${y(m.standEnde)}" r="${m.monat === gewaehlt ? 6 : 4}">` +
      `<title>${MONATE[m.monat - 1]} ${m.jahr}: ${m.standEnde} Personen</title></circle>` +
      (zeigen ? `<text class="wert" x="${x(m)}" y="${y(m.standEnde) - 12}" text-anchor="middle">${m.standEnde}</text>` : "");
  }).join("");
  const achse = monate.map((m) =>
    `<text class="achse${m.zukunft ? " leise" : ""}" x="${x(m)}" y="${H - 8}" text-anchor="middle">${KURZ[m.monat - 1]}</text>`).join("");
  const markierung = monate.find((m) => m.monat === gewaehlt);
  const beschreibung = da.map((m) => `${KURZ[m.monat - 1]} ${m.standEnde}`).join("; ");
  return `<svg viewBox="0 0 ${B} ${H}" role="img" aria-label="Personalstand am Monatsende: ${text(beschreibung)}">
    ${markierung ? `<rect class="markierung" x="${x(markierung) - band / 2 + 2}" y="4" width="${band - 4}" height="${H - 8}" rx="8"/>` : ""}
    <line class="grundlinie" x1="${links}" x2="${B - links}" y1="${H - unten}" y2="${H - unten}"/>
    ${da.length ? `<path class="linie-stand" d="${linie}"/>` : ""}${punkte}${achse}</svg>`;
}

// Waagrechte Balken für eine Verteilung
function verteilungBalken(titel, eintraege, name) {
  if (!eintraege.length) return "";
  const summe = eintraege.reduce((s, e) => s + e.anzahl, 0);
  const max = eintraege[0].anzahl;
  const zeigen = eintraege.slice(0, 8);
  const rest = eintraege.slice(8).reduce((s, e) => s + e.anzahl, 0);
  if (rest) zeigen.push({ wert: null, anzahl: rest, sonstige: true });
  return `<figure class="karte verteilung"><figcaption>${text(titel)}</figcaption><ul>` +
    zeigen.map((e) => `<li><span class="v-name">${text(e.sonstige ? "Sonstige" : name(e.wert))}</span>` +
      `<span class="v-balken" aria-hidden="true"><span style="width:${Math.max(2, (e.anzahl / max) * 100).toFixed(1)}%"></span></span>` +
      `<span class="v-zahl">${zahl(e.anzahl)} <small>(${zahl((e.anzahl / summe) * 100)} %)</small></span></li>`).join("") +
    `</ul></figure>`;
}

function teilHeute(stand, zeilen, heute) {
  const aktiv = zeilen.filter((z) => k.imDienst(z, heute)).length;
  const vza = k.vollzeitaequivalente(zeilen, heute, stand.organisation?.vollzeit_stunden || 40);
  const jahre = k.betriebszugehoerigkeit(zeilen, heute);
  const kosten = geladen.entgelt ? k.personalkosten(geladen.entgelt, zeilen, heute) : null;
  const ort = (id) => stand.standorte.find((s) => s.id === id)?.name || "unbekannt";
  const funktion = (id) => stand.funktionen.find((f) => f.id === id)?.name || "unbekannt";
  return `<section class="start-teil" aria-labelledby="t-heute">
    <h2 id="t-heute">Personal heute</h2>
    <div class="kacheln">
      ${kachel("Im Dienst", zahl(aktiv), "Personen mit laufendem Dienstverhältnis")}
      ${vza !== null ? kachel("Vollzeitäquivalente", zahl(vza, 1),
        `Wochenstunden ÷ ${zahl(stand.organisation?.vollzeit_stunden || 40)} Stunden`) : ""}
      ${kachel("Ø Betriebszugehörigkeit", jahre === null ? "–" : `${zahl(jahre, 1)} J.`, "seit dem Eintritt")}
      ${kosten ? kachel("Brutto im Monat", `€\u00a0${zahl(kosten.summe)}`,
        `laut Dienstzettel, ${zahl(kosten.anzahl)} von ${zahl(aktiv)} mit Betrag, ohne Zulagen`) : ""}
    </div>
    <div class="verteilungen">
      ${verteilungBalken("Nach Arbeitsort", k.verteilung(zeilen, "standort_id", heute), ort)}
      ${verteilungBalken("Nach Beschäftigungsart", k.verteilung(zeilen, "beschaeftigungsart", heute), (w) => ART[w] || w)}
      ${verteilungBalken("Nach Funktion", k.verteilung(zeilen, "funktion_id", heute), funktion)}
    </div>
  </section>`;
}

function personenListe(eintraege, zusatz) {
  if (!eintraege.length) return '<p class="leise">Keine.</p>';
  return `<ul class="personen">${eintraege.slice(0, 6).map((z) =>
    `<li><a href="#akte/${text(z.dienstverhaeltnis_id)}">${text(`${z.nachname} ${z.vorname}`)}</a>` +
    `<span>${text(zusatz(z))}</span></li>`).join("")}</ul>` +
    (eintraege.length > 6 ? `<p class="leise">und ${eintraege.length - 6} weitere</p>` : "");
}

function teilAchtung(stand, zeilen, heute, probezeit) {
  const h = k.hinweise(zeilen, heute, probezeit, 30);
  const box = (titel, eintraege, zusatz) =>
    `<div class="karte achtung"><h3>${text(titel)} <span class="anzahl">${zahl(eintraege.length)}</span></h3>${personenListe(eintraege, zusatz)}</div>`;
  const zuTun = [];
  if (geladen.offen) zuTun.push(`<a class="karte zu-tun" href="#offen"><span class="kachel-wert">${zahl(geladen.offen.length)}</span>Offene Punkte</a>`);
  if (geladen.unterschreiben) zuTun.push(`<a class="karte zu-tun" href="#unterschreiben"><span class="kachel-wert">${zahl(geladen.unterschreiben.length)}</span>Zu unterschreiben</a>`);
  return `<section class="start-teil" aria-labelledby="t-achtung">
    <h2 id="t-achtung">Was bald ansteht <small>nächste 30 Tage</small></h2>
    ${zuTun.length ? `<div class="zu-tun-reihe">${zuTun.join("")}</div>` : ""}
    <div class="achtung-raster">
      ${box("Noch nicht angemeldet", h.nichtAngemeldet, (z) => `ab ${datum(z.eintritt)}`)}
      ${box("Kommende Dienstantritte", h.kommend, (z) => datum(z.eintritt))}
      ${box("Probezeit endet", h.probezeit, (z) => datum(z.bis))}
      ${stand.recht.sieht_personendaten ? box("Befristung endet", h.befristung, (z) => datum(z.bis)) : ""}
    </div>
  </section>`;
}

// ------------------------------------------------------------------ PDF herunterladen

// Nur mit dem Recht „Analyse herunterladen“. Die Edge Function prüft das Recht noch einmal,
// vermerkt den Download im Protokoll und erzeugt das PDF.
async function herunterladen() {
  const knopf = $("#start-pdf");
  const meldung = $("#start-pdf-meldung");
  knopf.disabled = true;
  knopf.textContent = "PDF wird erstellt …";
  meldung.hidden = true;
  try {
    const { datei, name } = await api.analysePdf({ jahr: auswahl.jahr, monat: auswahl.monat, standort: auswahl.standort || null });
    const url = URL.createObjectURL(datei);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (fehler) {
    meldung.textContent = fehler.message;
    meldung.hidden = false;
  } finally {
    knopf.disabled = false;
    knopf.textContent = "PDF herunterladen";
  }
}

function knopfZeigen(stand) {
  $("#start-pdf").hidden = !stand.recht.darf_analyse_export;
}
