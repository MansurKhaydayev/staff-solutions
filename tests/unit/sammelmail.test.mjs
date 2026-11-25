import { test } from "node:test";
import assert from "node:assert/strict";
import { dateiname, betreff, mailText, mailLink } from "../../app/sammelmail.js";

const fall = (n, art = "anmeldung", extra = {}) => ({ art, nachname: `Muster${n}`, vorname: "Max", gesellschaft: "DemoFit Steiermark GmbH",
  datum: "2026-11-30", ...extra });

test("Dateiname: Datum, Lohnverrechner, Art, Name", () => {
  assert.equal(dateiname({ datum: "2026-11-25", lohnverrechner: "Demo Lohnbüro", art: "anmeldung", nachname: "Muster", vorname: "Max" }),
    "2026-11-25_Demo-Lohnbuero_Anmeldung_Muster-Max.pdf");
});

test("Dateiname: Sonderzeichen werden zu erlaubten Zeichen", () => {
  const n = dateiname({ datum: "2026-11-25", lohnverrechner: "Lohn & Co.", art: "abmeldung", nachname: "Đorđević O'Brien", vorname: "Groß" });
  assert.equal(n, "2026-11-25_Lohn-Co_Abmeldung_Dordevic-OBrien-Gross.pdf");
  assert.match(n, /^[A-Za-z0-9_.-]+$/);
});

test("Betreff: Anzahl je Art, Einzahl und Mehrzahl, Datum", () => {
  const f = [fall(1), fall(2), fall(3), fall(4, "abmeldung")];
  assert.equal(betreff(f, "2026-11-25"), "Staff-Solutions: 3 Anmeldungen, 1 Abmeldung, 25.11.2026");
  assert.equal(betreff([fall(1, "storno")], "2026-11-25"), "Staff-Solutions: 1 Storno, 25.11.2026");
  assert.equal(betreff([fall(1, "korrektur"), fall(2, "korrektur"), fall(3, "anmeldung")], "2026-11-25"),
    "Staff-Solutions: 1 Anmeldung, 2 Korrekturen, 25.11.2026");
});

test("Text: Zeile je Fall, keine heiklen Daten", () => {
  const t = mailText([fall(1, "abmeldung", { sv_nummer: "1238010190", iban: "AT611904300234573201", brutto: 1300 })]);
  assert.ok(t.startsWith("Guten Tag,"));
  assert.ok(t.includes("anbei die folgenden Unterlagen:"));
  assert.ok(t.includes("- Abmeldung: Muster1 Max, DemoFit Steiermark GmbH, 30.11.2026"));
  assert.ok(t.trimEnd().endsWith("Mit freundlichen Grüßen"));
  assert.ok(!/\d{10}/.test(t), "keine Versicherungsnummer");
  assert.ok(!/AT\d{2}/.test(t), "keine IBAN");
  assert.ok(!t.includes("1300"), "kein Gehalt");
});

test("Viele Fälle: Link bleibt kurz, Text gekürzt", () => {
  const f = Array.from({ length: 45 }, (_, i) => fall(i + 1));
  const link = mailLink({ an: "lohn@demo.invalid", faelle: f, datum: "2026-11-25" });
  assert.ok(link.startsWith("mailto:lohn%40demo.invalid?subject="));
  assert.ok(link.length <= 1800, `Länge ${link.length}`);
  const text = decodeURIComponent(link.split("&body=")[1]);
  assert.match(text, /… und \d+ weitere, siehe Anhänge/);
  assert.ok(text.trimEnd().endsWith("Mit freundlichen Grüßen"));
  assert.equal(mailText(f).match(/^- /gm).length, 30);
  assert.ok(mailText(f).includes("… und 15 weitere, siehe Anhänge"));
});
