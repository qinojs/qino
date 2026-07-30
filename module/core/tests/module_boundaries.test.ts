import { assertEquals } from "./deps.ts";
import { fromFileUrl, toFileUrl } from "../../../deps.ts";

const moduleDir = fromFileUrl(new URL("../../", import.meta.url));

async function* files(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = dir + entry.name;
    if (entry.isDirectory) {
      yield* files(path + "/");
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield path;
    }
  }
}

function imports(source: string): string[] {
  const specs: string[] = [];
  // The clause must not contain a quote, or the optional group would hunt for a `from` across
  // statements and swallow side-effect-only imports (`import "./x.ts";`) whole.
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) if (match[1].startsWith(".")) specs.push(match[1]);
  return specs;
}

// A module has exactly two doors outward: mod.ts for its functionality, and tests/deps.ts for what
// other modules' tests need. plugin.ts is the loader's, not a door. Everything else — lib/, view/,
// parts/, bots/, apt.ts, render.ts — is internal, which is what frees those names to describe a
// role instead of a privacy level.
//
// A root file therefore must not be a second door. Where that looked unavoidable it was a defect:
// cms/apt.ts imported cms/mod.ts, so mod.ts could not re-export it without a cycle. core states the
// rule in its own barrel — internal files import siblings directly, never the barrel — and once cms
// followed it, mod.ts could carry api and tree like everything else.
const DOORS = /^(?:mod\.ts|tests\/deps\.ts)$/;

// Two side doors still stand, both because the consumer is the actual defect. Neither belongs in
// cms/mod.ts: `api` is a manifest field the loader already publishes as app.aptTree["cms"], and
// apt-exports.ts is the business logic behind cms/apt.ts, which exposes tree as an endpoint already.
// See PLAN-modules.md — fixing them changes ai's Bot interface and how the widget fetches its data.
const OPEN = new Set([
  "cms.frontend.ai/bots/cmsHelper.ts -> cms/apt.ts",          // toTools() at module scope, no app yet
  "cms.frontend.2/view/widgets/tree.ts -> cms/apt-exports.ts", // calls the fn directly instead of via apt
]);

Deno.test("modules only consume public APIs of other modules", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const fileRel = file.slice(moduleDir.length);
    for (const spec of imports(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      const [targetModule, ...path] = targetRel.split("/");
      if (fileRel.split("/")[0] === targetModule) continue; // a module owns its own files
      const door = path.join("/");
      if (OPEN.has(`${fileRel} -> ${targetRel}`)) continue;
      if (!DOORS.test(door)) errors.push(`${fileRel} imports ${targetRel} — not a door (mod.ts, tests/deps.ts)`);
      else if (door.startsWith("tests/") && !fileRel.includes("/tests/")) errors.push(`${fileRel} imports test-only ${targetRel}`);
    }
  }
  assertEquals(errors, []);
});

// The cycle condition, stated exactly: whatever mod.ts re-exports from must not import mod.ts back.
// A plugin.ts may use its own barrel — nothing re-exports plugin.ts, so no cycle can form.
Deno.test("nothing mod.ts re-exports imports mod.ts back", async () => {
  const errors: string[] = [];
  for (const entry of Deno.readDirSync(moduleDir)) {
    if (!entry.isDirectory) continue;
    const barrel = `${moduleDir}${entry.name}/mod.ts`;
    const source = await Deno.readTextFile(barrel).catch(() => null);
    if (source === null) continue;
    for (const spec of imports(source)) {
      const dep = fromFileUrl(new URL(spec, toFileUrl(barrel)));
      const depSource = await Deno.readTextFile(dep).catch(() => null);
      if (depSource === null) continue;
      if (imports(depSource).some((s) => fromFileUrl(new URL(s, toFileUrl(dep))) === barrel)) {
        errors.push(`${dep.slice(moduleDir.length)} imports the mod.ts that re-exports it — import its lib/ sibling directly`);
      }
    }
  }
  assertEquals(errors, []);
});

// Prospective package boundary: everything named cms* ships as @qino/cms, the rest as @qino/qino.
// An edge from the lower to the upper layer would make the cms unextractable, so it is an error
// here — type-only imports included, since they are just as unresolvable across a package split.
const isCms = (mod: string) => mod === "cms" || mod.startsWith("cms.");

Deno.test("the qino layer never imports from the cms layer", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const sourceModule = file.slice(moduleDir.length).split("/")[0];
    if (isCms(sourceModule)) continue;
    for (const spec of imports(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      if (isCms(targetRel.split("/")[0])) {
        errors.push(`${file.slice(moduleDir.length)} imports ${targetRel}`);
      }
    }
  }
  assertEquals(errors, []);
});

// A mod.ts export nobody imports is dead weight: while every consumer lives inside this tree,
// "unused" is a reliable signal and removing it is free. That stops being true the day an outside
// consumer exists — then this test's premise is gone and the rule becomes "used, or listed below".
const EXTERNAL = new Set([
  "core/mod.ts honoAdapter", // demo/server.ts mounts the app under hono
]);

/** Names a statement pulls from another file; "*" = namespace or star, meaning "all of them". */
function importedNames(source: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const re = /(?:^|\n)\s*(?:import|export)\s+(?<clause>(?:type\s+)?[\s\S]*?)?\s*from\s*["'](?<spec>[^"']+)["']/g;
  for (const { groups } of source.matchAll(re)) {
    const spec = groups!.spec;
    if (!spec.startsWith(".")) continue;
    const names = found.get(spec) ?? new Set();
    found.set(spec, names);
    const clause = (groups!.clause ?? "").replace(/^type\s+/, "").trim();
    if (/^\*/.test(clause)) { names.add("*"); continue; }
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (clause.slice(0, braces?.index ?? clause.length).trim().replace(/,$/, "")) names.add("default");
    for (const part of braces?.[1].split(",") ?? []) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return found;
}

function exportedNames(source: string): Set<string> | undefined {
  if (/^export\s+\*\s+from/m.test(source)) return undefined; // opaque, cannot enumerate
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|async\s+function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s+(?:type\s+)?\{([\s\S]*?)\}/gm)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (bits[0]) names.add(bits.at(-1)!);
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add("default");
  return names;
}

Deno.test("no mod.ts exports anything nobody imports", async () => {
  const used = new Map<string, Set<string>>();   // absolute path -> names
  for await (const file of files(moduleDir)) {
    for (const [spec, names] of importedNames(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const set = used.get(target) ?? new Set();
      used.set(target, set);
      for (const n of names) set.add(n);
    }
  }
  const errors: string[] = [];
  for (const entry of Deno.readDirSync(moduleDir)) {
    if (!entry.isDirectory) continue;
    const mod = moduleDir + entry.name + "/mod.ts";
    const source = await Deno.readTextFile(mod).catch(() => null);
    if (source === null) continue;
    const names = exportedNames(source);
    const hits = used.get(mod);
    if (!names || hits?.has("*")) continue;
    const rel = `${entry.name}/mod.ts`;
    for (const n of [...names].sort()) {
      if (hits?.has(n) || EXTERNAL.has(`${rel} ${n}`)) continue;
      errors.push(`${rel} exports unused ${n} — drop it, or add it to EXTERNAL with a reason`);
    }
  }
  assertEquals(errors, []);
});
