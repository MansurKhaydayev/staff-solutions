import { test } from "node:test";
import assert from "node:assert/strict";
import { dateiPruefen, dateiPfad, sha256 } from "../../app/datei.js";

test("dateiPruefen: PDF mit genau 10 MB ist erlaubt", () => {
  assert.equal(dateiPruefen({ type: "application/pdf", size: 10485760 }), null);
});
test("dateiPruefen: ein Byte zu groß", () => {
  assert.match(dateiPruefen({ type: "application/pdf", size: 10485761 }), /größer als 10 MB/);
});
test("dateiPruefen: GIF ist nicht erlaubt", () => {
  assert.equal(dateiPruefen({ type: "image/gif", size: 10 }), "Nur PDF, JPG oder PNG.");
});
test("dateiPfad: Firma/Dienstverhältnis/Kategorie/zufälliger Name mit Endung", () => {
  assert.match(dateiPfad("o", "d", "onboarding", "image/jpeg"), /^o\/d\/onboarding\/[0-9a-f-]{36}\.jpg$/);
});
test("sha256 liefert 64 Hex-Zeichen", async () => {
  const h = await sha256(new Blob(["abc"]));
  assert.equal(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
