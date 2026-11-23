// Kleine Verbindung zu Supabase ohne zusätzliche Bibliothek.
// Anmeldung: Supabase Auth. Daten: Supabase REST (PostgREST).
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const SPEICHER = "staff-solutions-sitzung";
let sitzung = null;

try {
  sitzung = JSON.parse(sessionStorage.getItem(SPEICHER)) || null;
} catch {
  sitzung = null;
}

function merken(s) {
  sitzung = s;
  try {
    if (s) sessionStorage.setItem(SPEICHER, JSON.stringify(s));
    else sessionStorage.removeItem(SPEICHER);
  } catch {
    /* ohne Browser-Speicher bleibt die Sitzung nur bis zum Neuladen */
  }
}

export class ApiFehler extends Error {
  constructor(text, status) {
    super(text);
    this.status = status;
  }
}

async function anfrage(pfad, { methode = "GET", koerper, kopf = {} } = {}) {
  const antwort = await fetch(SUPABASE_URL + pfad, {
    method: methode,
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(sitzung ? { Authorization: `Bearer ${sitzung.access_token}` } : {}),
      ...kopf,
    },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await antwort.text();
  const daten = text ? JSON.parse(text) : null;
  if (!antwort.ok) {
    if (antwort.status === 401 && sitzung) merken(null);
    const meldung = daten?.message || daten?.msg || daten?.error_description || "Unbekannter Fehler";
    throw new ApiFehler(meldung, antwort.status);
  }
  return daten;
}

export const angemeldet = () => Boolean(sitzung);
export const benutzer = () => sitzung?.user || null;

export async function anmelden(email, passwort) {
  const s = await anfrage("/auth/v1/token?grant_type=password", {
    methode: "POST",
    koerper: { email, password: passwort },
  });
  merken(s);
  return s.user;
}

export async function abmelden() {
  try {
    await anfrage("/auth/v1/logout", { methode: "POST" });
  } finally {
    merken(null);
  }
}

export const lesen = (tabelle, abfrage = "select=*") => anfrage(`/rest/v1/${tabelle}?${abfrage}`);

export const funktion = (name, parameter = {}) =>
  anfrage(`/rest/v1/rpc/${name}`, { methode: "POST", koerper: parameter });

// Ändert Zeilen und gibt sie zurück. Kommt nichts zurück, hat die Datenbank
// die Änderung nicht erlaubt (Zugriffsregeln) – das melden wir als Fehler.
export async function aendern(tabelle, filter, werte) {
  const zeilen = await anfrage(`/rest/v1/${tabelle}?${filter}`, {
    methode: "PATCH",
    koerper: werte,
    kopf: { Prefer: "return=representation" },
  });
  if (!zeilen?.length) throw new ApiFehler("Diese Änderung ist für deinen Zugang nicht erlaubt.", 403);
  return zeilen;
}

export async function anlegen(tabelle, werte) {
  return anfrage(`/rest/v1/${tabelle}`, { methode: "POST", koerper: werte, kopf: { Prefer: "return=representation" } });
}

// Dateien der Personalakte (privater Speicher "personalakte")
const BUCKET = "personalakte";

// Lädt eine Datei hoch. Vorhandene Dateien werden nie überschrieben (x-upsert: false).
export async function hochladen(pfad, datei) {
  const antwort = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${pfad}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${sitzung?.access_token}`,
      "Content-Type": datei.type,
      "x-upsert": "false",
    },
    body: datei,
  });
  if (!antwort.ok) {
    let meldung = "Hochladen hat nicht geklappt.";
    try { const d = await antwort.json(); if (d?.message) meldung = `Hochladen hat nicht geklappt: ${d.message}`; } catch { /* leer */ }
    throw new ApiFehler(meldung, antwort.status);
  }
}

// Zeitlich begrenzter Link (5 Minuten) zum Ansehen oder Herunterladen
export async function dateiLink(pfad, herunterladen = false) {
  const d = await anfrage(`/storage/v1/object/sign/${BUCKET}/${pfad}`, {
    methode: "POST",
    koerper: { expiresIn: 300 },
  });
  const url = `${SUPABASE_URL}/storage/v1${d.signedURL}`;
  return herunterladen ? `${url}&download` : url;
}
