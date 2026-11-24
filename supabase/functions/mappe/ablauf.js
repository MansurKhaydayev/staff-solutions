// Ablauf der Edge Function „mappe“ – ohne Deno-Abhängigkeiten, damit er in Node getestet werden kann.
// abh = { nutzer, rpcAlsNutzer, rpcAlsDienst, hochladen, laden, sha256, pdfLib, uuid }
import { pdfErstellen } from "./pdf.js";

const PNG_MIN = 1000;          // kleiner ist kein erkennbarer Namenszug
const PNG_MAX = 2_000_000;
const PNG_KOPF = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Meldung = für die Person bestimmt (eigene Prüfung oder Meldung der Datenbank)
export class Meldung extends Error {}
const fehler = (text) => { throw new Meldung(text); };

function datumWien(d = new Date()) {
  return new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// gleicher Wortlaut wie app.frist_meldung in der Datenbank
function fristMeldung(iso) {
  const tag = new Date(`${iso}T12:00:00Z`);
  const wochentag = new Intl.DateTimeFormat("de-AT", { timeZone: "UTC", weekday: "long" }).format(tag);
  const datum = new Intl.DateTimeFormat("de-AT", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(tag);
  return `Zu kurzfristig. Frühester Dienstantritt ist ${wochentag}, ${datum}. Bei dringendem Bedarf „Dringende Anmeldung“ wählen.`;
}

function pngLesen(b64) {
  if (!b64 || typeof b64 !== "string") fehler("Bitte unterschreiben.");
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { fehler("Die Unterschrift konnte nicht gelesen werden."); }
  if (!PNG_KOPF.every((x, i) => bytes[i] === x)) fehler("Die Unterschrift konnte nicht gelesen werden.");
  if (bytes.length < PNG_MIN) fehler("Bitte deutlich unterschreiben.");
  if (bytes.length > PNG_MAX) fehler("Die Unterschrift ist zu groß.");
  return bytes;
}

async function ablegen(abh, pfadPdf, pdf, pfadPng, png) {
  await abh.hochladen(pfadPdf, pdf, "application/pdf");
  if (png) await abh.hochladen(pfadPng, png, "image/png");
  return { pdf_hash: await abh.sha256(pdf), png_hash: png ? await abh.sha256(png) : null };
}

async function mitarbeiter(token, nutzer, d, abh) {
  if (!["dienstzettel", "onboarding"].includes(d.art)) fehler("Unbekannte Unterlage.");
  const abgelehnt = d.ergebnis === "abgelehnt";
  if (!abgelehnt && d.ergebnis !== "unterschrieben") fehler("Unbekanntes Ergebnis.");

  const m = await abh.rpcAlsNutzer(token, "mappe_inhalt", { p_dienstverhaeltnis_id: d.dienstverhaeltnis_id });
  const schritt = (m.schritte || []).find((s) => s.art === d.art && (d.art === "dienstzettel" || s.unterlage_id === d.unterlage_id));
  if (!schritt) fehler("Diese Unterlage gehört nicht zu dieser Person.");
  if (schritt.status !== "offen") {
    // Erneutes Absenden derselben Fassung (z. B. Antwort ging im Netz verloren): dasselbe Dokument liefern
    if (schritt.dokument_id && schritt.fassung === d.fassung) return schritt.dokument_id;
    fehler("Diese Unterlage ist schon erledigt.");
  }
  if (schritt.fassung !== d.fassung) fehler("Die Daten wurden geändert. Bitte die Mappe neu öffnen.");
  // Fristregel vor dem Hochladen prüfen (die Datenbank prüft beim Eintragen noch einmal)
  if (d.art === "dienstzettel" && m.frist?.verletzt && !d.dringend_grund?.trim()) fehler(`FRIST: ${fristMeldung(m.frist.fruehester)}`);
  const png = abgelehnt ? null : pngLesen(d.png_base64);

  const id = abh.uuid();
  const basis = `${m.organisation_id}/${m.dienstverhaeltnis_id}`;
  const ordner = d.art === "dienstzettel" ? "vereinbarung" : "onboarding";
  const heute = datumWien();
  const pdf = await pdfErstellen(abh.pdfLib, { ...schritt.inhalt, dokument_nr: id, inhalt_hash: schritt.fassung },
    abgelehnt ? { abgelehnt: { ort: m.ort, datum: heute } } : { mitarbeiter: { png, ort: m.ort, datum: heute } });
  const pfadPdf = `${basis}/${ordner}/${id}.pdf`;
  const pfadPng = png ? `${basis}/unterschrift/${id}.png` : null;
  const h = await ablegen(abh, pfadPdf, pdf, pfadPng, png);

  return abh.rpcAlsDienst("mappe_ablegen", {
    p_user: nutzer.id, p_dienstverhaeltnis_id: m.dienstverhaeltnis_id, p_art: d.art,
    p_unterlage_id: d.art === "onboarding" ? d.unterlage_id : null, p_fassung: d.fassung,
    p_ergebnis: abgelehnt ? "abgelehnt" : "unterschrieben",
    p_pdf_pfad: pfadPdf, p_pdf_hash: h.pdf_hash, p_png_pfad: pfadPng, p_png_hash: h.png_hash,
    p_dringend_grund: d.dringend_grund?.trim() || null,
  });
}

async function arbeitgeber(token, nutzer, d, abh) {
  const a = await abh.rpcAlsNutzer(token, "arbeitgeber_inhalt", { p_dokument_id: d.dokument_id });
  if (a.erledigt) {
    if (a.fassung === d.fassung) return a.dokument_id;  // erneutes Absenden nach Netzfehler
    fehler("Dieser Dienstzettel ist schon fertig unterschrieben.");
  }
  if (a.fassung !== d.fassung) fehler("Die Daten wurden geändert. Bitte die Liste neu öffnen.");
  const png = pngLesen(d.png_base64);
  const pngMa = a.mitarbeiter?.png_pfad ? await abh.laden(a.mitarbeiter.png_pfad) : null;

  const id = abh.uuid();
  const basis = `${a.organisation_id}/${a.dienstverhaeltnis_id}`;
  const pdf = await pdfErstellen(abh.pdfLib, { ...a.inhalt, dokument_nr: id, inhalt_hash: a.fassung }, {
    mitarbeiter: { png: pngMa, ort: a.mitarbeiter?.ort, datum: a.mitarbeiter?.datum ? datumWien(new Date(a.mitarbeiter.datum)) : "" },
    arbeitgeber: { png, ort: a.arbeitgeber_ort, datum: datumWien() },
  });
  const pfadPdf = `${basis}/vereinbarung/${id}.pdf`;
  const pfadPng = `${basis}/unterschrift/${id}.png`;
  const h = await ablegen(abh, pfadPdf, pdf, pfadPng, png);

  return abh.rpcAlsDienst("arbeitgeber_ablegen", {
    p_user: nutzer.id, p_dokument_id: d.dokument_id, p_fassung: d.fassung,
    p_pdf_pfad: pfadPdf, p_pdf_hash: h.pdf_hash, p_png_pfad: pfadPng, p_png_hash: h.png_hash,
  });
}

// anfrage = { token, daten } → { status, body }
export async function bearbeiten(anfrage, abh) {
  const nutzer = anfrage.token ? await abh.nutzer(anfrage.token) : null;
  if (!nutzer) return { status: 401, body: { meldung: "Bitte neu anmelden." } };
  const d = anfrage.daten || {};
  try {
    let id;
    if (d.aktion === "mitarbeiter") id = await mitarbeiter(anfrage.token, nutzer, d, abh);
    else if (d.aktion === "arbeitgeber") id = await arbeitgeber(anfrage.token, nutzer, d, abh);
    else fehler("Unbekannte Aktion.");
    return { status: 200, body: { dokument_id: id } };
  } catch (e) {
    if (!(e instanceof Meldung)) {
      console.error(e);
      return { status: 500, body: { meldung: "Technischer Fehler. Bitte noch einmal versuchen." } };
    }
    if (e.message.startsWith("FRIST: ")) return { status: 400, body: { meldung: e.message.slice(7), frist: true } };
    return { status: 400, body: { meldung: e.message } };
  }
}
