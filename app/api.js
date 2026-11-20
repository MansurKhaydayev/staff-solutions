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
