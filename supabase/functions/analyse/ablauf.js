// Ablauf der Edge Function „analyse“ – ohne Deno-Abhängigkeiten, damit er in Node getestet werden kann.
// Alles läuft mit dem Zugang der Person (kein geheimer Schlüssel nötig): Die Datenbank prüft das Recht
// „Analyse herunterladen“, vermerkt den Download und liefert nur die Daten, die diese Rolle sehen darf.
// abh = { nutzer(token), rpc(token, name, params), lesen(token, tabelle, abfrage), pdfLib, schrift, jetzt() }
import { berichtErstellen } from "./bericht.js";
import { analysePdf } from "./pdf.js";
import { mitStatus } from "./kennzahlen.js";

export class Meldung extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wien(d) {
  const teile = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return { heute: `${teile.year}-${teile.month}-${teile.day}`,
    jetzt: `${teile.day}.${teile.month}.${teile.year} ${teile.hour}:${teile.minute}` };
}

const antwort = (status, meldung) => ({ status, body: { meldung } });

export async function bearbeiten({ token, daten }, abh) {
  if (!token) return antwort(401, "Bitte neu anmelden.");
  const nutzer = await abh.nutzer(token);
  if (!nutzer) return antwort(401, "Bitte neu anmelden.");

  const jahr = Number(daten?.jahr), monat = Number(daten?.monat);
  const standort = daten?.standort || null;
  if (!Number.isInteger(jahr) || !Number.isInteger(monat) || monat < 1 || monat > 12) return antwort(400, "Bitte einen gültigen Monat wählen.");
  if (standort !== null && !UUID.test(String(standort))) return antwort(400, "Diesen Arbeitsort gibt es nicht.");

  try {
    // Zuerst vermerken: ohne Recht gibt es hier einen Fehler und kein PDF
    const protokollNr = await abh.rpc(token, "analyse_export_vermerken", { p_jahr: jahr, p_monat: monat, p_standort: standort });
    const profil = (await abh.lesen(token, "profil", `select=rolle&user_id=eq.${nutzer.id}`))[0];
    if (!profil) throw new Meldung("Dein Zugang ist keiner Firma zugeordnet.");
    const [rechte, orgs, standorte, funktionen, verzeichnis, status] = await Promise.all([
      abh.lesen(token, "rollen_recht", `select=bezeichnung,sieht_personendaten,sieht_entgelt&rolle=eq.${encodeURIComponent(profil.rolle)}`),
      abh.lesen(token, "organisation", "select=name,probezeit_monate,vollzeit_stunden"),
      abh.lesen(token, "standort", "select=id,name"),
      abh.lesen(token, "funktion", "select=id,name"),
      abh.rpc(token, "mitarbeiter_verzeichnis", {}),
      // Status aus dem Austritt-Modul („nicht angetreten“ zählt nicht); fehlt er, zählt alles wie bisher
      abh.rpc(token, "mitarbeiter_status", {}).catch(() => null),
    ]);
    const zeilen = mitStatus(verzeichnis, status);
    const recht = rechte[0] || {};
    const entgelt = recht.sieht_entgelt
      ? await abh.lesen(token, "entgelt", "select=dienstverhaeltnis_id,brutto,gueltig_ab,storniert_am") : null;
    const zeit = wien(abh.jetzt());
    const bericht = berichtErstellen({
      zeilen, entgelt, organisation: orgs[0], standorte, funktionen, recht, rolle: recht.bezeichnung || profil.rolle,
      jahr, monat, standort, heute: zeit.heute, jetzt: zeit.jetzt, protokollNr,
    });
    const pdf = await analysePdf(abh.pdfLib, bericht, abh.schrift);
    const ortTeil = standort ? `-${(standorte.find((s) => s.id === standort)?.name || "ort").normalize("NFKD").replace(/[^A-Za-z0-9-]+/g, "-")}` : "";
    return { status: 200, pdf, dateiname: `Personalanalyse-${jahr}-${String(monat).padStart(2, "0")}${ortTeil}.pdf` };
  } catch (e) {
    if (e instanceof Meldung) return antwort(403, e.message);
    throw e;
  }
}
