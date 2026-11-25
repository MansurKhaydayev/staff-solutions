// Edge Function „analyse“: erzeugt die Personalanalyse als PDF zum Herunterladen.
// Sie arbeitet nur mit dem Zugang der anfragenden Person (öffentlicher Schlüssel + deren Token).
// Recht und Protokoll prüft die Datenbank in public.analyse_export_vermerken.
import * as pdfLib from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
// Dieselbe gekürzte Schrift wie die Edge Function „mappe“, beim Hochladen fest vom angegebenen Commit geholt.
// Ändert sich mappe/schrift.js, hier den Commit anpassen (ein Test prüft, dass beide Funktionen denselben nutzen).
import { DEJAVU_NORMAL, DEJAVU_FETT } from
  "https://raw.githubusercontent.com/MansurKhaydayev/staff-solutions/f921495842c5ee2d3dc0670c0a2f727472a2ec65/supabase/functions/mappe/schrift.js";
import { bearbeiten, Meldung } from "./ablauf.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition",
};

async function antwortLesen(r: Response) {
  const text = await r.text();
  const daten = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Meldung(daten?.message || "Die Datenbank hat die Anfrage abgelehnt.");
  return daten;
}

const kopf = (token: string) => ({ apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

const abh = {
  nutzer: async (token: string) => {
    const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id } : null;
  },
  rpc: async (token: string, name: string, params: unknown) =>
    antwortLesen(await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: "POST", headers: kopf(token), body: JSON.stringify(params) })),
  lesen: async (token: string, tabelle: string, abfrage: string) =>
    antwortLesen(await fetch(`${URL_}/rest/v1/${tabelle}?${abfrage}`, { headers: kopf(token) })),
  pdfLib,
  schrift: { fontkit, normal: DEJAVU_NORMAL, fett: DEJAVU_FETT },
  jetzt: () => new Date(),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Nur POST", { status: 405, headers: CORS });
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
  let daten = {};
  try { daten = await req.json(); } catch { /* leer → Prüfung meldet ungültigen Monat */ }
  try {
    const a = await bearbeiten({ token, daten }, abh);
    if (a.pdf) {
      return new Response(a.pdf, { status: 200, headers: { ...CORS, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${a.dateiname}"`, "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ meldung: "Das PDF konnte nicht erstellt werden." }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
