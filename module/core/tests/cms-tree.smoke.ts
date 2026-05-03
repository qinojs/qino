// deno-lint-ignore-file no-explicit-any
/**
 * Strukturelle Smoke-Prüfung des echten cms/apt.ts-Baums.
 * Keine DB, nur walk/toTools/toHono-Setup (fängt Kollisionen und Verdrahtung ab).
 */

import { toHono, toTools } from "../lib/apt.ts";
import { api } from "../../cms/apt.ts";

// 1. toHono registriert alle Routen ohne Fehler (Collision-Check läuft dabei)
const app = toHono(api);
console.log("OK   toHono(api) — no setup errors");

// 2. toTools liefert eine Tool-Liste mit Beschreibung + Parametern
const tools = toTools(api);
console.log(`\nGenerated ${tools.length} tools from cms/apt.ts:`);
for (const t of tools) {
  console.log(`  - ${t.name.padEnd(28)} ${t.description}`);
}

// 3. Smoke: die erwarteten Namen sind dabei
const names = new Set(tools.map((t) => t.name));
const expected = [
  "getTree",
  "getPage",
  "deletePage",
  "getPageTree",
  "setPageTitle",
  "setPageVisible",
  "createPageCopy",
  "setPageAccessUsers",
];
console.log();
for (const name of expected) {
  console.log(names.has(name) ? "OK  " : "MISS", name);
}
