// Dateien für die Personalakte: prüfen, Fingerabdruck berechnen, Ablagepfad vergeben.

export const ERLAUBTE_TYPEN = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
export const MAX_BYTES = 10 * 1024 * 1024;

// Meldung oder null
export function dateiPruefen(datei) {
  if (!ERLAUBTE_TYPEN[datei.type]) return "Nur PDF, JPG oder PNG.";
  if (datei.size > MAX_BYTES) return "Die Datei ist größer als 10 MB.";
  return null;
}

// SHA-256 der Datei als Hex-Text (Fingerabdruck, belegt später, dass die Datei unverändert ist)
export async function sha256(datei) {
  const puffer = await crypto.subtle.digest("SHA-256", await datei.arrayBuffer());
  return [...new Uint8Array(puffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Ablagepfad: <firma>/<dienstverhältnis>/<kategorie>/<zufall>.<endung> – Namen vergibt das System
export function dateiPfad(org, dv, kategorie, typ) {
  return `${org}/${dv}/${kategorie}/${crypto.randomUUID()}.${ERLAUBTE_TYPEN[typ]}`;
}
