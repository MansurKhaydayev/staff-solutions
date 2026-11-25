// Edge Function „mappe“: erzeugt das PDF der Unterschriftsmappe, legt PDF und Unterschrift im Speicher ab
// und trägt das Dokument in der Datenbank ein. Die Schlüssel kommen nur aus Deno.env – nie aus dem Code.
import * as pdfLib from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { DEJAVU_NORMAL, DEJAVU_FETT } from "./schrift.js";
import { bearbeiten, Meldung } from "./ablauf.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const DIENST = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "personalakte";

// Zugang läuft über den Bearer-Token (keine Cookies) – daher darf jede Adresse anfragen.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function rpc(schluessel: string, token: string, name: string, params: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: schluessel, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await r.text();
  const daten = text ? JSON.parse(text) : null;
  // Fehler aus der Datenbank sind Meldungen für die Person (z. B. „Die Daten wurden geändert …“)
  if (!r.ok) throw new Meldung(daten?.message || "Die Datenbank hat die Anfrage abgelehnt.");
  return daten;
}

const pfadUrl = (pfad: string) => `${URL_}/storage/v1/object/${BUCKET}/${pfad.split("/").map(encodeURIComponent).join("/")}`;

const abh = {
  nutzer: async (token: string) => {
    const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id } : null;
  },
  rpcAlsNutzer: (token: string, name: string, params: unknown) => rpc(ANON, token, name, params),
  rpcAlsDienst: (name: string, params: unknown) => rpc(DIENST, DIENST, name, params),
  hochladen: async (pfad: string, bytes: Uint8Array, typ: string) => {
    const r = await fetch(pfadUrl(pfad), {
      method: "POST",
      headers: { apikey: DIENST, Authorization: `Bearer ${DIENST}`, "Content-Type": typ, "x-upsert": "false" },
      body: bytes,
    });
    if (!r.ok) throw new Error(`Hochladen fehlgeschlagen (${r.status}): ${await r.text()}`);
  },
  laden: async (pfad: string) => {
    const r = await fetch(pfadUrl(pfad), { headers: { apikey: DIENST, Authorization: `Bearer ${DIENST}` } });
    if (!r.ok) throw new Error(`Laden fehlgeschlagen (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  },
  sha256: async (bytes: Uint8Array) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join(""),
  pdfLib,
  schrift: { fontkit, normal: DEJAVU_NORMAL, fett: DEJAVU_FETT },
  uuid: () => crypto.randomUUID(),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Nur POST", { status: 405, headers: CORS });
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
  let daten = {};
  try { daten = await req.json(); } catch { /* leerer Körper → „Unbekannte Aktion“ */ }
  const { status, body } = await bearbeiten({ token, daten }, abh);
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
});
