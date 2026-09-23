// deno-lint-ignore-file no-explicit-any
import { fromFileUrl, isAbsolute, toFileUrl, $item } from "../deps.ts";
import { getCtx } from "./ctx/Ctx.ts";
import { enableItemSchemaDefaults, errMsg, isEmptyObject, newestMtime, unixTime } from "./util.ts";
import { fs } from "./fs.ts";
import { safeFetch } from "./fileStream.ts";
import { uid } from "./crypto.ts";

import type { App } from "./App.ts";

type DbSchema = { properties: Record<string, unknown> };

export const isModuleName = (name: string): boolean =>
  /^[a-zA-Z0-9._-]+$/.test(name) && name !== "." && name !== ".." && !Object.hasOwn(Object.prototype, name);

export function resolveSpecifier(app: App, spec: string | URL): string {
  if (spec instanceof URL) return spec.href;
  if (spec.startsWith("./") || spec.startsWith("../")) return new URL(spec, toFileUrl(app.dir)).href;
  if (isAbsolute(spec)) return toFileUrl(spec).href;
  return import.meta.resolve(spec);
}

/** manifest.json — what must be known before the module's code runs. Everything else is an export. */
export type Manifest = {
  name?: string;
  description?: string;
  dependencies?: string[];
  files?: string[];
};

/** Read a module's manifest. May be missing: a module can be just a plugin.ts. */
export async function readManifest(source: string): Promise<Manifest> {
  const res = await fetch(new URL("manifest.json", source)).catch(() => null); // reads file: and http(s): alike
  if (!res?.ok) return {};
  const manifest = await res.json();
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Manifest of ${source} must be an object`);
  if (!Array.isArray(manifest.dependencies ?? [])) throw new Error(`Manifest of ${source}: dependencies must be an array`);
  return manifest;
}

export type Plugin = Record<string, any> & {
  // Object = static schema. Function = built from the merged schema (runs after all static
  // ones), e.g. for tables derived from other modules' tables.
  dbSchema?: DbSchema | ((merged: DbSchema) => DbSchema);
  init?(app: App, opts: { signal: AbortSignal }): void | Promise<void>;
  // Once per app, not per boot: install() creates the module's content and files (tables are
  // migrated anyway), uninstall() removes them.
  install?(ctx: { app: App; module: Plugin }): void | Promise<void>;
  uninstall?(ctx: { app: App; module: Plugin }): void | Promise<void>;
  settingsSchema?: Record<string, unknown>;
  ctxSettingsSchema?: Record<string, unknown>;
  api?: Record<string, unknown>;
};

function mergeSchema(a: any, b: any): any {
  for (const [k, v] of Object.entries(b ?? {})) {
    if (Array.isArray(v)) a[k] = [...new Set([...(Array.isArray(a[k]) ? a[k] : []), ...v])];
    else if (v && typeof v === "object") a[k] = mergeSchema(a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
}

export class Module {
  #app: App;
  #name: string;
  #plugin: Plugin;
  #manifest: Manifest;
  #source: string;
  #abort = new AbortController();

  constructor(app: App, name: string, plugin: Plugin, manifest: Manifest, source: string) {
    this.#app = app;
    this.#name = name;
    this.#plugin = plugin;
    this.#manifest = manifest;
    this.#source = source;
  }
  get name(): string { return this.#name; }
  get plugin(): Plugin { return this.#plugin; }
  /** What the module says about itself before its code runs. */
  get manifest(): Manifest { return this.#manifest; }
  get description(): string { return this.#manifest.description ?? ""; }
  get dependencies(): string[] { return this.#manifest.dependencies ?? []; }
  /** Resolved file:/https: URL of the plugin file. */
  get source(): string { return this.#source; }
  /** Directory the module lives in; undefined for remote modules. */
  get dir(): string | undefined { return this.#source.startsWith("file:") ? fromFileUrl(this.#source).replace(/\/[^/]+$/, "/") : undefined; }
  /** Directory of the served files. A remote module serves the files mirrored on import, in a
   *  subfolder of its cache so they don't mix with its own cache files. */
  get pubDir(): string { return this.dir ? this.dir + "pub" : this.cache + "remote/pub"; }
  /** The module's data files — backed up, never deleted. pub/ below it is served. */
  get data(): string { return `${this.#app.dir}data/${this.name}/`; }
  /** Derived files, rebuildable from data/ — may be deleted any time, no backup. */
  get cache(): string { return `${this.#app.dir}cache/${this.name}/`; }
  /** Scratch space for single operations — may be deleted when nothing runs, no backup. */
  get tmp(): string { return `${this.#app.dir}tmp/${this.name}/`; }
  /** The module dir as URL; only pub/ is reachable. Always an address of this app, since a remote
   *  module's public files are mirrored on import. */
  get modUrl(): string { return `${getCtx().req.moduleUrl}${this.name}/`; }
  /** data/ as a URL; only pub/ below it is reachable. */
  get dataUrl(): string { return `${getCtx().req.dataUrl}${this.name}/`; }
  // New signal per link; abort() on unlink removes what init() registered with it.
  newSignal(): AbortSignal { return (this.#abort = new AbortController()).signal; }
  abort(): void { this.#abort.abort(); }
  toString(): string { return this.name; }
}

export class ModuleManager {
  #app: App;
  #modules = new Map<string, Module>();
  #pending: { spec: string; name?: string }[] = [];
  #linked = new Set<string>(); // modules whose hooks have run (imported ⊇ linked)
  #declared = new Set<string>(); // from add(), i.e. the application itself — not uninstallable
  #installed = new Map<string, number>(); // name → time install() ran; the `module` table in memory
  #failed = new Map<string, string>(); // installed but not importable this boot → name: why
  #booting = false; // inside init(): install() only registers, the link pass follows

  /** Finds a module nobody declared. Set by the StoreManager, so this manager needs no stores. */
  locate: (name: string) => Promise<string | undefined> = async () => undefined;

  constructor(app: App) {
    this.#app = app;
  }

  get(name: string): Module | undefined { return this.#modules.get(name); }

  /** All imported modules, linked or not (imported ⊇ linked). */
  all(): Map<string, Module> { return this.#modules; }

  /** Linked modules, dependencies first. With a name: that module, if linked. */
  linked(): Module[];
  linked(name: string): Module | undefined;
  linked(name?: string): Module[] | Module | undefined {
    if (name === undefined) return Array.from(this.#linked, (n) => this.#modules.get(n)!);
    if (this.#linked.has(name)) return this.#modules.get(name);
  }

  /** The module, if declared by the application itself — those can't be uninstalled. */
  declared(name: string): Module | undefined {
    if (this.#declared.has(name)) return this.#modules.get(name);
  }

  // Installed modules that failed to import this boot, and why; uninstall() removes them.
  failures(): Map<string, string> { return this.#failed; }

  /** Run order: dependencies before dependents. */
  order(): string[] { return this.#order(); }

  /** Register a module for import during app.init(). Relative strings resolve against dir; for
   *  "relative to this file" pass `new URL("./x/plugin.ts", import.meta.url)`. */
  add(spec: string | URL, name?: string): this {
    this.#pending.push({ spec: resolveSpecifier(this.#app, spec), ...(name && { name }) });
    return this;
  }

  async import(spec: string, expectedName?: string): Promise<Module> {
    if (spec.startsWith("./") || spec.startsWith("../")) throw new Error(`Relative module specifier "${spec}" is not supported by import(). Use app.modules.add("${spec}") before app.init()`);
    if (spec.endsWith("/")) throw new Error(`Plugin import needs a file, not a directory: ${spec}`);
    if (!/\/plugin\.(?:ts|js)(?:[?#].*)?$/.test(spec)) throw new Error(`Plugin import needs a plugin.ts or plugin.js file: ${spec}`);
    const path = spec.startsWith("file:") ? fromFileUrl(spec) : isAbsolute(spec) ? spec : undefined;
    const source = path ? toFileUrl(path).href : spec;
    // The manifest is read, not imported: a store must not need to run code.
    const manifest = await readManifest(source);
    if (manifest.name !== undefined && (typeof manifest.name !== "string" || !manifest.name)) throw new Error(`Manifest of ${source} has an invalid name`);
    const inferredName = /\/([^/?#]+)\/plugin\.(?:ts|js)(?:[?#].*)?$/.exec(source)?.[1];
    const name = expectedName ?? manifest.name ?? (inferredName && decodeURIComponent(inferredName));
    if (!name) throw new Error(`Module name cannot be inferred: ${source}`);
    if (!isModuleName(name)) throw new Error(`Invalid module name "${name}": ${source}`);
    if (expectedName && manifest.name && expectedName !== manifest.name)
      throw new Error(`Module name mismatch: store has "${expectedName}", manifest says "${manifest.name}"`);
    const existing = this.#modules.get(name);
    if (existing) {
      if (existing.source !== source) throw new Error(`Duplicate module name "${name}": ${existing.source} vs ${source}`);
      return existing;
    }

    const same = this.#modules.values().find((mod) => mod.source === source);
    if (same) throw new Error(`Plugin ${source} is already registered as "${same.name}"`);

    const plugin = await import(source);
    const mod = new Module(this.#app, name, plugin, manifest, source);
    if (!mod.dir) await mirrorPub(mod);
    this.#modules.set(name, mod);
    return mod;
  }

  async init(): Promise<void> {
    for (const { spec, name } of this.#pending) await this.import(spec, name);
    this.#pending = [];
    this.#declared = new Set(this.#modules.keys());
    // `url` says which modules to import, but only those modules complete the schema. So read the
    // table before migration — a new database has no table, an older install no `url` column.
    const rows = await this.#app.db.query`SELECT * FROM module`.catch(() => []);
    for (const { name, url, installed } of rows) {
      if (installed) this.#installed.set(name, installed);
      if (!url || this.#modules.has(name)) continue;
      // A deleted folder or unreachable host must not stop the boot: log, skip, and let the module
      // page offer uninstall to remove the row.
      await this.import(url, name).catch((e) => {
        this.#failed.set(name, errMsg(e));
        console.error(`Module "${name}" is installed but could not be imported from ${url}:`, e);
      });
    }
    await this.#importDependencies();
    this.#skipMissing();
    // In passes: an install() hook may install more modules, which need the same ordering and
    // schema merge as the first round, not a nested link().
    this.#booting = true;
    try {
      for (let count = 0; count !== this.#modules.size;) {
        count = this.#modules.size;
        const order = this.#order();
        await this.#applyDbSchema(order);
        this.#applySchemas(order);
        for (const name of order) if (!this.#linked.has(name)) await this.#linkOne(this.#modules.get(name)!);
      }
    } finally { this.#booting = false; }
  }

  /** Import, remember and link a module — the persistent counterpart of add(). */
  async install(spec: string, name?: string): Promise<Module> {
    const mod = await this.import(spec, name);
    // Missing dependencies that can be located are installed too, deepest first. Ones that can't
    // be found throw: the module would break the next boot, so it must not reach the table.
    try {
      for (const need of mod.dependencies) {
        if (this.#modules.has(need)) continue;
        const url = await this.locate(need);
        if (!url) throw new Error(`Cannot install "${mod.name}": needs ${need}`);
        await this.install(url, need);
      }
    } catch (e) {
      this.#modules.delete(mod.name); // nothing half-registered
      throw e;
    }
    await this.#app.db.table("module").ensure({ name: mod.name, url: mod.source });
    if (!this.#booting) {
      await this.link(mod.name); // during boot init() links it in a later pass
      for (const name of [...this.#failed.keys()]) await this.link(name).then(() => this.#failed.delete(name), () => {});
    }
    return mod;
  }

  /** Run install() again to restore what was deleted. Changed content stays: install hooks only
   *  fill gaps. */
  async repair(name: string): Promise<void> {
    const mod = this.#modules.get(name);
    if (!mod || !this.#linked.has(name)) throw new Error(`Cannot repair "${name}": not linked`);
    await mod.plugin.install?.({ app: this.#app, module: mod.plugin });
    const installed = unixTime();
    this.#installed.set(name, installed);
    await this.#app.db.table("module").ensure({ name, installed });
  }

  /** Reset to defaults: uninstall, then install again. Needs an uninstall() hook — otherwise use
   *  repair(). */
  async reset(name: string): Promise<void> {
    const mod = this.#modules.get(name);
    if (!mod || !this.#linked.has(name)) throw new Error(`Cannot reset "${name}": not linked`);
    if (!mod.plugin.uninstall) throw new Error(`Cannot reset "${name}": the module has no uninstall()`);
    await mod.plugin.uninstall({ app: this.#app, module: mod.plugin });
    await this.repair(name);
  }

  /** Unlink, let the module clean up, and forget it. Unlike unlink(), its data is removed. */
  async uninstall(name: string): Promise<void> {
    if (this.#declared.has(name)) throw new Error(`Cannot uninstall "${name}": the application declares it`);
    const mod = this.#modules.get(name);
    if (!mod && !await this.#app.db.table("module").get(name)) throw new Error(`Cannot uninstall "${name}": unknown`);
    if (mod) { // a leftover row without plugin: only the row is removed
      this.unlink(name);
      await mod.plugin.uninstall?.({ app: this.#app, module: mod.plugin });
    }
    await this.#app.db.table("module").delete(name);
    // cache/ and tmp/ go, data/ stays: derived files are cheap to lose, and a remote module's
    // mirror must not linger for a name that may return as another module
    if (mod) await fs.remove(mod.cache, { recursive: true }).catch(() => {});
    this.#installed.delete(name);
    this.#failed.delete(name);
    this.#modules.delete(name);
  }

  /** Load the module from another source; its data stays. Throws like unlink() while a linked
   *  module depends on it. The row is written last, so a failed import keeps the old source. */
  async relocate(name: string, url: string): Promise<void> {
    if (this.#declared.has(name)) throw new Error(`Cannot relocate "${name}": the application declares it`);
    if (!this.#modules.has(name)) throw new Error(`Cannot relocate "${name}": not imported`); // not an install
    const linked = this.#linked.has(name); // unlink() clears it; an inactive module stays inactive
    this.unlink(name);
    this.#modules.delete(name); // import() refuses known names
    await this.import(url, name);
    if (linked) await this.link(name);
    await this.#app.db.table("module").ensure({ name, url });
  }

  // Run a registered module's hooks at runtime. Idempotent; its dependencies must already be linked.
  async link(name: string): Promise<void> {
    const mod = this.#modules.get(name);
    if (!mod) throw new Error(`Cannot link "${name}": not imported`);
    if (this.#linked.has(name)) return;
    for (const need of mod.dependencies)
      if (!this.#linked.has(need)) throw new Error(`Cannot link "${name}": needs "${need}", which is not linked`);
    const order = this.#order([...this.#linked, name]);
    await this.#applyDbSchema(order);
    this.#applySchemas(order);
    await this.#linkOne(mod);
  }

  // Reverse a module's hooks. Stays registered (can be linked again); tables, locales and install content remain.
  unlink(name: string): void {
    const mod = this.#modules.get(name);
    if (!mod || !this.#linked.has(name)) return;
    for (const other of this.#modules.values())
      if (other !== mod && this.#linked.has(other.name) && other.dependencies.includes(name))
        throw new Error(`Cannot unlink "${name}": "${other.name}" needs it`);
    mod.abort(); // removes listeners/timers init() registered with the signal
    delete this.#app.apiTree[name];
    this.#linked.delete(name);
    this.#applySchemas(this.#order([...this.#linked]));
  }

  // Run one module's hooks.
  async #linkOne(mod: Module): Promise<void> {
    const { plugin } = mod;
    try {
      await plugin.init?.(this.#app, { signal: mod.newSignal() });
      if (!this.#installed.has(mod.name)) {
        await plugin.install?.({ app: this.#app, module: plugin });
        const installed = unixTime();
        await this.#app.db.table("module").ensure({ name: mod.name, installed }); // db first, so memory never claims a failed write
        this.#installed.set(mod.name, installed);
      }
      await this.#loadLocales(mod);
      if (plugin.api) this.#app.apiTree[mod.name] = plugin.api;
      // Asset URLs carry the newest file time, so after install or update clients load the new files.
      for (const dir of [mod.pubDir, mod.data + "pub"])
        this.#app.assetRev = Math.max(this.#app.assetRev, await newestMtime(dir));
      this.#linked.add(mod.name);
    } catch (e) { mod.abort(); throw e; } // undo what init() registered with the signal
  }

  // Rebuild app/ctx settings schema from the given (dependency-ordered) modules and re-apply defaults.
  #applySchemas(order: string[]): void {
    const appSettingsSchema = { properties: {} as Record<string, unknown> };
    const ctxSettingsSchema = { properties: {} as Record<string, unknown> };
    for (const name of order) {
      const { plugin } = this.#modules.get(name)!;
      appSettingsSchema.properties[name] = plugin.settingsSchema;
      ctxSettingsSchema.properties[name] = plugin.ctxSettingsSchema;
    }
    const root = this.#app.settings[$item];
    root.setSchema(appSettingsSchema);
    enableItemSchemaDefaults(root);
    this.#app.ctxSettingsSchema = ctxSettingsSchema;
  }

  // Merge the given modules' dbSchema (static, then function-form) and migrate additively.
  async #applyDbSchema(order: string[]): Promise<void> {
    const dbSchema = { properties: {} };
    const schemas = order.map((name) => this.#modules.get(name)!.plugin.dbSchema);
    for (const schema of schemas) if (typeof schema !== "function") mergeSchema(dbSchema, schema);
    // Function-form dbSchema runs after the static merge — for tables derived from other modules.
    for (const schema of schemas) if (typeof schema === "function") mergeSchema(dbSchema, schema(dbSchema));
    if (!isEmptyObject(dbSchema.properties)) {
      await this.#app.db.migrate(dbSchema, { patch: true });
      this.#app.db.schema = dbSchema;
      await this.#app.db.loadTables();
    }
  }

  // Seed translations from a module's locale/<lang>.json (namespace = module name; core = "")
  async #loadLocales(mod: Module): Promise<void> {
    const dir = mod.dir;
    if (!dir) return;
    const ns = mod.name === "core" ? "" : mod.name;
    try {
      for (const e of await fs.list(dir + "locale/")) {
        const m = e.name.match(/^([a-z]{2})\.json$/);
        if (m) await this.#app.languages.import(m[1], ns, await fs.text(dir + "locale/" + e.name));
      }
    } catch (e) { /* module has no locale dir */
      if ((e as { code?: string }).code !== "ENOENT") console.error(`locale import failed for module "${mod.name}":`, e);
    }
  }

  /** Import the dependencies of the declared modules via locate(). What can't be located stays
   *  missing and is reported by #skipMissing() and #order(). */
  async #importDependencies(): Promise<void> {
    const tried = new Set<string>();
    // One at a time: the next round picks up the new module's own dependencies.
    const next = () => this.#modules.values().flatMap((mod) => mod.dependencies)
      .find((need) => !this.#modules.has(need) && !tried.has(need));
    for (let need = next(); need; need = next()) {
      tried.add(need);
      const url = await this.locate(need);
      if (!url) continue; // reported by #skipMissing()
      await this.import(url, need).catch((e) => {
        this.#failed.set(need, errMsg(e));
        console.error(`Module "${need}" is needed but could not be imported from ${url}:`, e);
      });
    }
  }

  // An installed module whose dependency is gone is marked broken; the boot continues.
  #skipMissing(): void {
    const gone = (need: string) => !this.#modules.has(need) || this.#failed.has(need);
    // A broken module breaks its dependents, so repeat until nothing changes.
    for (let again = true; again;) {
      again = false;
      for (const mod of this.#modules.values()) {
        if (this.#declared.has(mod.name) || this.#failed.has(mod.name)) continue;
        const need = mod.dependencies.find(gone);
        if (!need) continue;
        const why = `Module "${mod.name}" needs "${need}", but it is not imported`;
        this.#failed.set(mod.name, why);
        console.error(`${why}; skipping installed module`);
        again = true;
      }
    }
  }

  // Dependency-ordered subset (default: all imported). Recurses dependencies only within the set.
  #order(names: string[] = this.#modules.keys().filter((name) => !this.#failed.has(name)).toArray()): string[] {
    const order: string[] = [];
    const seen: Record<string, "visiting" | "done"> = {};
    const set = new Set(names);
    const visit = (name: string) => {
      if (seen[name] === "done") return;
      if (seen[name] === "visiting") throw new Error(`Circular module dependency: ${name}`);
      const mod = this.#modules.get(name);
      if (!mod) throw new Error(`Module "${name}" is not imported`);
      seen[name] = "visiting";
      for (const need of mod.dependencies) {
        if (!this.#modules.has(need)) throw new Error(`Module "${name}" needs "${need}", but it is not imported`);
        if (set.has(need)) visit(need);
      }
      seen[name] = "done";
      order.push(name);
    };
    for (const name of names) visit(name);
    return order;
  }

}

/**
 * Download a remote module's public files once into `remote/` in its cache, where the static route
 * looks for them. Only files listed in the manifest, from the module's own source, and only missing
 * ones — a store address is a fixed release, so files never change. Otherwise every asset would
 * come from a foreign origin: slower, an extra CSP source, and SVG `<use>` would not work at all.
 *
 * A file that fails to download stays missing; it must not stop the module.
 */
async function mirrorPub(mod: Module): Promise<void> {
  const files = (mod.manifest.files ?? []).filter((file: string) => file.startsWith("pub/") && !file.includes(".."));
  if (!files.length) return;
  const dir = `${mod.cache}remote/`;
  // Source + file list identify the release; a different address is a different mirror.
  const stamp = dir + ".source";
  const marked = await fs.text(stamp).catch(() => "");
  if (marked === mod.source && (await Promise.all(
    files.map((file: string) => fs.isFile(dir + file)),
  )).every(Boolean)) return;
  // one mkdir per directory, not per file
  const dirs = new Set(files.map((file: string) => (dir + file).replace(/\/[^/]+$/, "")));
  await Promise.all([...dirs].map((d) => fs.mkdir(d).catch(() => {})));
  const got = await Promise.all(files.map(async (file: string) => {
    const target = dir + file;
    try {
      const res = await safeFetch(new URL(file, mod.source).href);
      if (!res.ok) throw new Error(`${res.status}`);
      // write to a temp name, then move: half-written files are never served
      const tmp = `${target}.${uid(8)}.part`;
      await fs.write(tmp, new Uint8Array(await res.arrayBuffer()));
      await fs.rename(tmp, target).catch(() => fs.remove(tmp));
      return true;
    } catch (e) {
      console.warn(`module ${mod.name}: ${file} could not be fetched —`, errMsg(e));
      return false;
    }
  }));
  // only mark complete mirrors, so missing files are retried next time
  if (got.every(Boolean)) await fs.write(stamp, mod.source).catch(() => {});
}
