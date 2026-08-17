import { assertEquals, assertStringIncludes } from "./deps.ts";
import { fromFileUrl, toFileUrl } from "../deps.ts";
import { itemRoot, u2Root } from "../lib/util.ts";

const moduleDir = fromFileUrl(new URL("../../", import.meta.url));
const cmsLegacyDir = fromFileUrl(new URL("../../../cms-legacy/", import.meta.url));
const metaDir = fromFileUrl(new URL("../../../meta/", import.meta.url));
const testModuleDir = fromFileUrl(new URL("../../../test-modules/", import.meta.url));
const shp3Dir = fromFileUrl(new URL("../../../shp3/", import.meta.url));
const qinoDir = fromFileUrl(new URL("../../../", import.meta.url));
const stores = [moduleDir, shp3Dir, testModuleDir];
const sourceDirs = [moduleDir, cmsLegacyDir, metaDir, shp3Dir, testModuleDir];

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

// The clause must not contain a quote, or the optional group hunts for a `from` across statements
// and swallows side-effect-only imports (`import "./x.ts";`) whole. matchAll clones the regex, so
// both readers below can share this one.
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?<type>type\s+)?(?<clause>[^;'"]*?\s+from\s+)?["'](?<spec>[^"']+)["']/g;

/** Qino specifiers a file imports, each with the names taken from it ("*" = namespace or star). */
function imports(source: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const { groups } of source.matchAll(IMPORT)) {
    if (!groups!.spec.startsWith(".") && !groups!.spec.startsWith("@qino/qino")) continue;
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

/** Qino specifiers a file imports *values* from. `import type` and inline `type` names need no
 *  linked module, which is what keeps the duck-typed extension points free of dependencies. */
function valueImports(source: string): Set<string> {
  const found = new Set<string>();
  for (const { groups } of source.matchAll(IMPORT)) {
    const { type, spec } = groups!;
    if ((!spec.startsWith(".") && !spec.startsWith("@qino/qino")) || type) continue;
    const clause = (groups!.clause ?? "").replace(/\s+from\s+$/, "").trim();
    const braces = clause.match(/\{([\s\S]*?)\}/);
    // No clause is a side-effect import, and anything before the braces is a default or namespace —
    // both run the module. Otherwise it takes a value only if some name is not `type`-prefixed.
    if (!clause || clause.slice(0, braces?.index ?? clause.length).replace(/,$/, "").trim()) found.add(spec);
    else if (braces?.[1].split(",").some((name) => name.trim() && !/^type\s/.test(name.trim()))) found.add(spec);
  }
  return found;
}

/** Local target of a relative or @qino/qino package import. */
function targetPath(spec: string, file: string): string | undefined {
  const url = spec.startsWith(".") ? new URL(spec, toFileUrl(file)).href : import.meta.resolve(spec);
  return url.startsWith("file:") ? fromFileUrl(url) : undefined;
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
// `api` is a manifest field the loader already publishes as app.apiTree["cms"], and api-exports.ts is
// the logic behind cms/api.ts, which exposes tree as an endpoint. See PLAN-modules.md.
const OPEN = new Set([
  "cms.frontend.ai/bots/cmsHelper.ts -> cms/api.ts",           // toTools() at module scope, no app yet
  "cms.frontend.2/view/widgets/tree.ts -> cms/api-exports.ts", // calls the fn instead of going via api
]);

/** The module folders below a store directory, as `<store dir><module>/`. */
async function* moduleDirs(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory && await Deno.stat(`${dir}${entry.name}/manifest.json`).then(() => true, () => false)) {
      yield `${dir}${entry.name}/`;
    }
  }
}

/** Every file a module consists of, relative to its folder. `tests/` stays behind: a consumer runs
 *  the module, not its suite — the same cut the module copier makes. */
async function modulePaths(dir: string, base = dir): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) {
      if (dir === base && entry.name === "tests") continue;
      found.push(...await modulePaths(`${dir}${entry.name}/`, base));
    } else if (entry.isFile) found.push((dir + entry.name).slice(base.length));
  }
  return found.sort();
}

Deno.test("every module manifest has a description", async () => {
  const missing = [];
  for (const store of stores) {
    for await (const dir of moduleDirs(store)) {
      const manifest = JSON.parse(await Deno.readTextFile(dir + "manifest.json"));
      if (!manifest.description?.trim()) missing.push(dir.slice(store.length));
    }
  }
  assertEquals(missing, []);
});

// A remote consumer cannot list a directory, so a published module has to enumerate itself. Nothing
// keeps that list correct but this test: add an asset, forget the manifest, and it says so — with
// the array to paste. Modules that are not published carry no `files` and are not checked.
Deno.test("a manifest that lists its files lists all of them", async () => {
  for (const store of stores) {
    for await (const dir of moduleDirs(store)) {
      const manifest = JSON.parse(await Deno.readTextFile(dir + "manifest.json"));
      if (!manifest.files) continue;
      assertEquals(manifest.files.slice().sort(), await modulePaths(dir), `files of ${dir.slice(store.length)}`);
    }
  }
});

Deno.test("module icons expose the fragment rendered by moduleIcon", async () => {
  for (const store of stores) {
    for await (const dir of moduleDirs(store)) {
      const manifest = JSON.parse(await Deno.readTextFile(dir + "manifest.json"));
      if (!manifest.files?.includes("pub/module.svg")) continue;
      assertStringIncludes(await Deno.readTextFile(dir + "pub/module.svg"), 'id="main"', dir.slice(store.length));
    }
  }
});

async function assertStore(dir: string): Promise<void> {
  const store = JSON.parse(await Deno.readTextFile(dir + "store.json"));
  const plugins = [];
  for await (const entry of Deno.readDir(dir)) {
    const hasPlugin = entry.isDirectory && await Deno.stat(`${dir}${entry.name}/plugin.ts`).then((stat) => stat.isFile, () => false);
    if (hasPlugin) plugins.push(entry.name);
  }
  assertEquals(Object.keys(store.modules).sort(), plugins.sort());
}

Deno.test("module stores list every plugin directory", async () => {
  await assertStore(moduleDir);
  await assertStore(testModuleDir);
});

// The browser gets item.js from a CDN URL, which no import map can derive from the server pin
// (import.meta.resolve returns an opaque jsr: specifier). So the two are kept in step by hand.
Deno.test("browser itemRoot matches the pinned item.js version", async () => {
  const config = JSON.parse(await Deno.readTextFile(qinoDir + "deno.json"));
  const pinned = config.imports["@qino/item/"].match(/@(?:\^|~)?([\d.]+)\//)?.[1];
  assertEquals(itemRoot, `https://cdn.jsdelivr.net/gh/nuxodin/item.js@v${pinned}/`);
});

// A browser must be able to load them as modules: right MIME type, and CORS for a cross-origin
// import. That is exactly what jsr.io does not do, and why these are jsDelivr URLs.
Deno.test({
  name: "the browser CDN roots are loadable cross-origin",
  ignore: !(() => { try { return Deno.env.get("NET_TESTS"); } catch { return false; } })(),
  fn: async () => {
    for (const url of [itemRoot + "item.js", u2Root + "js/dialog/dialog.js"]) {
      const res = await fetch(url);
      assertEquals(res.ok, true, url);
      assertEquals(res.headers.get("access-control-allow-origin"), "*", url);
      assertEquals(res.headers.get("content-type")?.startsWith("application/javascript"), true, url);
      await res.body?.cancel();
    }
  },
});

Deno.test("test-store plugins are importable", async () => {
  const store = JSON.parse(await Deno.readTextFile(testModuleDir + "store.json"));
  for (const name of Object.keys(store.modules)) await import(toFileUrl(`${testModuleDir}${name}/plugin.ts`).href);
});

Deno.test("modules only consume public APIs of other modules", async () => {
  const errors = [];
  const roots: string[] = [];
  for (const store of sourceDirs) for await (const root of moduleDirs(store)) roots.push(root);
  const owner = (path: string) => roots.find((root) => path.startsWith(root));
  for (const sourceDir of sourceDirs) {
    for await (const file of files(sourceDir)) {
      const sourceRoot = owner(file);
      for (const spec of imports(await Deno.readTextFile(file)).keys()) {
        const target = targetPath(spec, file);
        if (!target) continue;
        const targetRoot = owner(target);
        if (!targetRoot || targetRoot === sourceRoot) continue;
        const fileRel = file.slice(qinoDir.length), targetRel = target.slice(qinoDir.length);
        if (file.startsWith(moduleDir) && target.startsWith(moduleDir) &&
          OPEN.has(`${file.slice(moduleDir.length)} -> ${target.slice(moduleDir.length)}`)) continue;
        const door = target.slice(targetRoot.length);
        if (spec.startsWith(".")) errors.push(`${fileRel} imports ${targetRel} relatively — use its package export`);
        else if (!DOORS.test(door)) errors.push(`${fileRel} imports ${targetRel} — not a door (mod.ts, tests/deps.ts)`);
        else if (door.startsWith("tests/") && !fileRel.includes("/tests/")) errors.push(`${fileRel} imports test-only ${targetRel}`);
      }
    }
  }
  assertEquals(errors, []);
});

// Optional integrations: a value import of a module that need not be linked, so the installation
// without it crashes on first use. Declaring the dependency is the wrong repair — it would drag the
// whole module in for a link, a widget or a prompt. They want an extension point, and until that
// vocabulary exists (see PLAN-modules.md) they stay named here rather than invisible.
const OPTIONAL = new Set([
  "cms.backend.superuser.db.query/lib/ai.ts -> ai", // "explain this query" is a bonus, not the console
  "cms.backend.superuser.db.query/render.ts -> ai",
  "cms.frontend.2/view/widgets/more.ts -> mail", // a dashboard widget per module is the pattern itself
  "cms.backend.superuser.error_report/plugin.ts -> fileEditor", // editorUrl: "open the file that threw"
  "cms.backend.superuser.module/detail.ts -> fileEditor",
  "cms.cont.html/options.ts -> fileEditor",
  "cms.cont.ts/options.ts -> fileEditor",
  "cms.frontend.2/view/widgets/superuser.ts -> fileEditor",
  "cms.templateParser/moduleTemplate.ts -> fileEditor",
]);

/** What a module may import values from. `dependencies` is transitive — declaring one module brings
 *  its own declarations along — and `core` is there for everyone, since `App` declares it itself. */
function linked(manifests: Map<string, string[]>, mod: string): Set<string> {
  const seen = new Set(["core", mod]);
  const walk = (name: string) => {
    for (const dep of manifests.get(name) ?? []) if (!seen.has(dep)) { seen.add(dep); walk(dep); }
  };
  walk(mod);
  return seen;
}

// A type import only has to compile, a value import has to *be there* at runtime. So this is the
// rule that keeps a module from crashing in an installation that never asked for its neighbour.
Deno.test("modules only take values from modules they depend on", async () => {
  const manifests = new Map<string, string[]>();
  for await (const dir of moduleDirs(moduleDir)) {
    const manifest = JSON.parse(await Deno.readTextFile(dir + "manifest.json"));
    manifests.set(dir.slice(moduleDir.length, -1), manifest.dependencies ?? []);
  }

  const errors = [];
  for await (const file of files(moduleDir)) {
    const fileRel = file.slice(moduleDir.length);
    if (fileRel.includes("/tests/")) continue; // a suite runs against the whole app, not one module
    const mod = fileRel.split("/")[0];
    if (!manifests.has(mod)) continue;
    const allowed = linked(manifests, mod);
    for (const spec of valueImports(await Deno.readTextFile(file))) {
      const target = targetPath(spec, file);
      if (!target) continue;
      if (!target.startsWith(moduleDir)) continue;
      const targetModule = target.slice(moduleDir.length).split("/")[0];
      if (allowed.has(targetModule) || OPTIONAL.has(`${fileRel} -> ${targetModule}`)) continue;
      errors.push(`${fileRel} takes values from "${targetModule}", which ${mod} does not depend on`);
    }
  }
  assertEquals(errors, []);
});

// Prospective package boundary: cms* ships as @qino/cms, the rest as @qino/qino. An edge from the
// lower to the upper layer would make the cms unextractable — type-only imports included, they are
// just as unresolvable across a package split.
const isCms = (mod: string) => mod === "cms" || mod.startsWith("cms.");

Deno.test("the qino layer never imports from the cms layer", async () => {
  const errors = [];
  for await (const file of files(moduleDir)) {
    const fileRel = file.slice(moduleDir.length);
    if (isCms(fileRel.split("/")[0])) continue;
    for (const spec of imports(await Deno.readTextFile(file)).keys()) {
      const target = targetPath(spec, file);
      if (!target) continue;
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
  "core/mod.ts Route", // test-modules/cms.cont.apitest consumes this public type
  "cms.cont.ts/mod.ts NodeRender", // types the node files cms.cont.ts generates, outside this tree
  // Step-up: an api verb calls requireStepUp and the browser branches on the error's code. No verb
  // demands one yet — the first will be store/module installation, once the dialog can answer it.
  "core/mod.ts requireStepUp",
  "core/mod.ts StepUpError",
]);

Deno.test("no mod.ts exports anything nobody imports", async () => {
  const used = new Map<string, Set<string>>();
  for (const sourceDir of sourceDirs) {
    for await (const file of files(sourceDir)) {
      for (const [spec, names] of imports(await Deno.readTextFile(file))) {
        const target = targetPath(spec, file);
        if (!target?.startsWith(moduleDir)) continue;
        const set = used.get(target) ?? new Set<string>();
        used.set(target, set);
        for (const name of names) set.add(name);
      }
    }
  }
  const errors = [];
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
