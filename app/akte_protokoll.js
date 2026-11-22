// Reiter „Protokoll“ (nur Büro): wer hat wann was an dieser Person geändert.
import * as api from "./api.js";
import { text, datum } from "./hilfen.js";

const TABELLEN = {
  mitarbeiter: "Person", mitarbeiter_sensibel: "Lohnverrechnungsdaten", dienstverhaeltnis: "Dienstverhältnis",
  vertragsstand: "Arbeitszeit", entgelt: "Entgelt", zulage: "Zulage", dokument: "Dokument",
  onboarding_klaerung: "Klärung", unterschrift: "Unterschrift",
};
const AKTIONEN = { INSERT: "angelegt", UPDATE: "geändert", DELETE: "gelöscht" };
const UNWICHTIG = new Set(["id", "organisation_id", "created_at", "created_by"]);

const zeit = (ts) => `${datum(ts)} ${new Date(ts).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}`;

function details(z) {
  if (z.aktion !== "UPDATE" || !z.alt || !z.neu) return "";
  return Object.keys(z.neu).filter((k) => !UNWICHTIG.has(k) && JSON.stringify(z.alt[k]) !== JSON.stringify(z.neu[k]))
    .map((k) => `${k}: ${z.alt[k] ?? "–"} → ${z.neu[k] ?? "–"}`).join(", ");
}

export async function zeigen(ziel, kopf) {
  const zeilen = await api.funktion("akte_protokoll", { p_dienstverhaeltnis_id: kopf.dienstverhaeltnis_id });
  if (!zeilen.length) { ziel.innerHTML = '<p class="leer-zustand">Noch keine Einträge.</p>'; return; }
  ziel.innerHTML = `<p class="einleitung klein">Die letzten ${zeilen.length} Einträge, neueste zuerst.</p>
    <div class="tabelle-rahmen"><table class="tabelle" id="protokoll-tabelle">
      <thead><tr><th scope="col">Zeitpunkt</th><th scope="col">Wer</th><th scope="col">Was</th><th scope="col">Details</th></tr></thead>
      <tbody>${zeilen.map((z) => `<tr><td>${text(zeit(z.zeitpunkt))}</td><td>${text(z.wer || "System")}</td>
        <td>${text(`${TABELLEN[z.tabelle] || z.tabelle} ${AKTIONEN[z.aktion] || z.aktion}`)}</td>
        <td>${text(details(z))}</td></tr>`).join("")}</tbody>
    </table></div>`;
}
