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
