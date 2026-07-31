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

/** Relative specifiers a file imports, each with the names taken from it ("*" = namespace or star). */
function imports(source: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  // The clause must not contain a quote, or the optional group hunts for a `from` across statements
  // and swallows side-effect-only imports (`import "./x.ts";`) whole.
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?<clause>[^;'"]*?\s+from\s+)?["'](?<spec>[^"']+)["']/g;
  for (const { groups } of source.matchAll(re)) {
    if (!groups!.spec.startsWith(".")) continue;
    const names = found.get(groups!.spec) ?? new Set<string>();
    found.set(groups!.spec, names);
    const clause = (groups!.clause ?? "").replace(/\s+from\s+$/, "").replace(/^type\s+/, "").trim();
    if (clause.startsWith("*")) { names.add("*"); continue; }
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (clause.slice(0, braces?.index ?? clause.length).replace(/,$/, "").trim()) names.add("default");
    for (const part of braces?.[1].split(",") ?? []) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return found;
}

/** Names a module exposes, or undefined when `export * from` makes them unenumerable. */
function exports(source: string): Set<string> | undefined {
  if (/^export\s+\*\s+from/m.test(source)) return undefined;
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

/** Every mod.ts, as module name -> absolute path. */
async function barrels(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const entry of Deno.readDirSync(moduleDir)) {
    const path = `${moduleDir}${entry.name}/mod.ts`;
    if (entry.isDirectory && await Deno.stat(path).then(() => true, () => false)) found.set(entry.name, path);
  }
  return found;
}

// A module has two doors outward: mod.ts, and tests/deps.ts for what other modules' tests need.
// plugin.ts is the loader's. Everything else is internal — which frees lib/, view/, parts/ and bots/
// to describe a role rather than a privacy level.
const DOORS = /^(?:mod\.ts|tests\/deps\.ts)$/;

// Still open, because in both cases the consumer is the defect and fixing it is a design change:
// `api` is a manifest field the loader already publishes as app.aptTree["cms"], and apt-exports.ts is
// the logic behind cms/apt.ts, which exposes tree as an endpoint. See PLAN-modules.md.
const OPEN = new Set([
  "cms.frontend.ai/bots/cmsHelper.ts -> cms/apt.ts",           // toTools() at module scope, no app yet
  "cms.frontend.2/view/widgets/tree.ts -> cms/apt-exports.ts", // calls the fn instead of going via apt
]);

Deno.test("modules only consume public APIs of other modules", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const fileRel = file.slice(moduleDir.length);
    for (const spec of imports(await Deno.readTextFile(file)).keys()) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      const [targetModule, ...path] = targetRel.split("/");
      if (fileRel.split("/")[0] === targetModule) continue; // a module owns its own files
      if (OPEN.has(`${fileRel} -> ${targetRel}`)) continue;
      const door = path.join("/");
      if (!DOORS.test(door)) errors.push(`${fileRel} imports ${targetRel} — not a door (mod.ts, tests/deps.ts)`);
      else if (door.startsWith("tests/") && !fileRel.includes("/tests/")) errors.push(`${fileRel} imports test-only ${targetRel}`);
    }
  }
  assertEquals(errors, []);
});

// Prospective package boundary: cms* ships as @qino/cms, the rest as @qino/qino. An edge from the
// lower to the upper layer would make the cms unextractable — type-only imports included, they are
// just as unresolvable across a package split.
const isCms = (mod: string) => mod === "cms" || mod.startsWith("cms.");

Deno.test("the qino layer never imports from the cms layer", async () => {
  const errors: string[] = [];
  for await (const file of files(moduleDir)) {
    const fileRel = file.slice(moduleDir.length);
    if (isCms(fileRel.split("/")[0])) continue;
    for (const spec of imports(await Deno.readTextFile(file)).keys()) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const targetRel = target.slice(moduleDir.length);
      if (isCms(targetRel.split("/")[0])) errors.push(`${fileRel} imports ${targetRel}`);
    }
  }
  assertEquals(errors, []);
});

// While every consumer lives in this tree, "nobody imports it" is a reliable signal and deleting is
// free. The day an outside consumer exists the premise is gone, and the rule becomes "used, or listed".
const EXTERNAL = new Set([
  "core/mod.ts honoAdapter", // demo/server.ts mounts the app under hono
  "cms.cont.ts/mod.ts NodeRender", // types the node files cms.cont.ts generates, outside this tree
]);

Deno.test("no mod.ts exports anything nobody imports", async () => {
  const used = new Map<string, Set<string>>();
  for await (const file of files(moduleDir)) {
    for (const [spec, names] of imports(await Deno.readTextFile(file))) {
      const target = fromFileUrl(new URL(spec, toFileUrl(file)));
      if (!target.startsWith(moduleDir)) continue;
      const set = used.get(target) ?? new Set<string>();
      used.set(target, set);
      for (const name of names) set.add(name);
    }
  }
  const errors: string[] = [];
  for (const [name, path] of await barrels()) {
    const names = exports(await Deno.readTextFile(path));
    const hits = used.get(path);
    if (!names || hits?.has("*")) continue;
    for (const n of [...names].sort()) {
      if (hits?.has(n) || EXTERNAL.has(`${name}/mod.ts ${n}`)) continue;
      errors.push(`${name}/mod.ts exports unused ${n} — drop it, or add it to EXTERNAL with a reason`);
    }
  }
  assertEquals(errors, []);
});
