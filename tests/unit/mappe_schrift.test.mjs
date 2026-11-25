import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { fontkit } from "./_global.mjs";
import { DEJAVU_NORMAL, DEJAVU_FETT } from "../../supabase/functions/mappe/schrift.js";

const ZEICHEN = "ĆćČčĐđŞşİıĞğŠšŽžŒœäöüß€§–„“Шевченкоλ";

test("Schrift: beide Schnitte sind TrueType", () => {
  for (const s of [DEJAVU_NORMAL, DEJAVU_FETT]) assert.deepEqual([...s.slice(0, 4)], [0, 1, 0, 0]);
});

test("Schrift: alle nötigen Zeichen vorhanden", () => {
  for (const s of [DEJAVU_NORMAL, DEJAVU_FETT]) {
    const f = fontkit.create(Buffer.from(s));
    for (const z of ZEICHEN) assert.ok(f.hasGlyphForCodePoint(z.codePointAt(0)), `fehlt: ${z}`);
  }
});

test("Schrift: klein genug", () => {
  assert.ok(statSync(new URL("../../supabase/functions/mappe/schrift.js", import.meta.url)).size < 450000);
});

// Die Edge Function lädt schrift.js beim Hochladen von GitHub (fest auf einen Commit), weil die Datei zu groß
// ist, um sie direkt mitzuschicken. Dieser Test stellt sicher, dass der Commit genau die aktuelle Datei enthält.
test("index.ts verweist auf den Commit mit der aktuellen schrift.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const index = readFileSync(new URL("../../supabase/functions/mappe/index.ts", import.meta.url), "utf8");
  const treffer = index.match(/raw\.githubusercontent\.com\/MansurKhaydayev\/staff-solutions\/([0-9a-f]{40})\/supabase\/functions\/mappe\/schrift\.js/);
  assert.ok(treffer, "index.ts importiert schrift.js nicht über einen festen Commit");
  const damals = execSync(`git show ${treffer[1]}:supabase/functions/mappe/schrift.js`, { maxBuffer: 10e6 });
  const jetzt = readFileSync(new URL("../../supabase/functions/mappe/schrift.js", import.meta.url));
  assert.ok(damals.equals(jetzt), "schrift.js hat sich seit dem Commit geändert – Commit in index.ts anpassen");
});
