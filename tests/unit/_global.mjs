// Global installierte Pakete (pdf-lib, pdfjs-dist) für Tests laden – die App selbst nutzt keine Pakete.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const wurzel = process.env.NODE_PATH || execSync("npm root -g").toString().trim();
const require = createRequire(`${wurzel}/`);
export const pdfLib = require(`${wurzel}/pdf-lib`);
export async function pdfText(bytes) {
  const pdfjs = await import(pathToFileURL(`${wurzel}/pdfjs-dist/legacy/build/pdf.mjs`).href);
  const dok = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0,
    standardFontDataUrl: `${wurzel}/pdfjs-dist/standard_fonts/` }).promise;
  const seiten = [];
  for (let i = 1; i <= dok.numPages; i++) {
    const t = await (await dok.getPage(i)).getTextContent();
    seiten.push(t.items.map((x) => x.str).join(" "));
  }
  return seiten;
}
// Kleines gültiges PNG (1×1 Pixel, schwarz)
export const MINI_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
