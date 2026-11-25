// Kleine Hilfen für alle Seiten der App.
import { datumAT, euro } from "./fristen.js";

export const $ = (sel, wurzel = document) => wurzel.querySelector(sel);

// Text sicher in HTML einsetzen
export function text(wert) {
  return String(wert ?? "").replace(/[&<>"']/g, (z) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[z]);
}

export const ART = { vollzeit: "Vollzeit", teilzeit: "Teilzeit", geringfuegig: "Geringfügig" };
export const stunden = (n) => `${Number(n).toLocaleString("de-DE")} Stunden`;
export const geld = (n) => (n === null || n === undefined ? "offen" : `€ ${euro(n)}`);
export const datum = (iso) => (iso ? datumAT(String(iso).slice(0, 10)) : "–");

// Tage von a bis b (ISO-Daten)
export const tageZwischen = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// Definitionsliste aus [Bezeichnung, Wert-HTML]-Paaren
export const liste = (paare) =>
  `<dl class="angaben">${paare.filter(Boolean).map(([b, w]) => `<div><dt>${text(b)}</dt><dd>${w}</dd></div>`).join("")}</dl>`;

// Jede Person bekommt dauerhaft ihre eigene Avatar-Farbe (aus dem Namen berechnet), das macht Listen lebendiger
export function avatarFarbe(name) {
  let n = 0;
  for (const z of String(name || "")) n = (n * 31 + z.charCodeAt(0)) % 997;
  return `av-${(n % 6) + 1}`;
}

// Tageszeit-Gruß
export function tagesgruss(stunde = new Date().getHours()) {
  if (stunde < 5) return "Gute Nacht";
  if (stunde < 11) return "Guten Morgen";
  if (stunde < 18) return "Schönen Tag";
  return "Guten Abend";
}
