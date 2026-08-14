// deno-lint-ignore-file no-explicit-any
import { fromFileUrl, isAbsolute, toFileUrl, $item } from "../deps.ts";
import { getCtx } from "./ctx/Ctx.ts";
import { enableItemSchemaDefaults, errMsg, unixTime } from "./util.ts";

import type { App } from "./App.ts";

type DbSchema = { properties: Record<string, unknown> };

export const isModuleName = (name: string): boolean =>
  /^[a-zA-Z0-9._-]+$/.test(name) && name !== "." && name !== ".." && !Object.hasOwn(Object.prototype, name);

export function resolveSpecifier(app: App, spec: string | URL): string {
  if (spec instanceof URL) return spec.href;
  if (spec.startsWith("./") || spec.startsWith("../")) return new URL(spec, toFileUrl(app.appPATH)).href;
  if (isAbsolute(spec)) return toFileUrl(spec).href;
  return import.meta.resolve(spec);
}

/** manifest.json — what has to be known before the module's code runs. Everything else is an export. */
export type Manifest = {
  name?: string;
  description?: string;
  dependencies?: string[];
  files?: string[];
};

/** Read a module's manifest. Absent is legal: a module may be nothing but a plugin.ts. */
export async function readManifest(source: string): Promise<Manifest> {
  const res = await fetch(new URL("manifest.json", source)).catch(() => null); // reads file: and http(s): alike
  if (!res?.ok) return {};
  const manifest = await res.json();
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Manifest of ${source} must be an object`);
  if (!Array.isArray(manifest.dependencies ?? [])) throw new Error(`Manifest of ${source}: dependencies must be an array`);
  return manifest;
}

export type Plugin = Record<string, any> & {
  // Object = static schema. Function = computed from the merged schema (runs after all
  // static ones), e.g. for tables derived from other modules' tables.
  dbSchema?: DbSchema | ((merged: DbSchema) => DbSchema);
  init?(app: App, opts: { signal: AbortSignal }): void | Promise<void>;
  // Runs once per app, not per boot: install() creates what the module owns (tables are migrated
  // anyway, so rather content and files), uninstall() removes it again.
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
  /** Where the module was imported from: resolved file:/https: URL of its plugin file. */
  get source(): string { return this.#source; }
  /** Directory the module lives in; undefined for remote modules. */
  get dir(): string | undefined { return this.#source.startsWith("file:") ? fromFileUrl(this.#source).replace(/\/[^/]+$/, "/") : undefined; }
  /** App files of this module — backed up, never deleted. What lies in pub/ is served. */
  get data(): string { return `${this.#app.appPATH}data/${this.name}/`; }
  /** Derived files, reproducible from data/ alone — droppable at any time, no backup. */
  get cache(): string { return `${this.#app.appPATH}cache/${this.name}/`; }
  /** Scratch space for a single operation — droppable when nothing runs, no backup. */
  get tmp(): string { return `${this.#app.appPATH}tmp/${this.name}/`; }
  /** The module dir as a URL; only pub/ below it is reachable. Remote modules serve from their source. */
  get modUrl(): string { return this.dir ? `${getCtx().req.moduleUrl}${this.name}/` : new URL(".", this.#source).href; }
  /** data/ as a URL; only pub/ below it is reachable. */
  get dataUrl(): string { return `${getCtx().req.appUrl}d/${this.name}/`; }
  // Fresh signal per (re-)link; abort() on unlink tears down what init() registered with it.
  newSignal(): AbortSignal { return (this.#abort = new AbortController()).signal; }
  abort(): void { this.#abort.abort(); }
  toString(): string { return this.name; }
}

export class ModuleManager {
  #app: App;
  #modules: Record<string, Module> = {};
  #pending: { spec: string; name?: string }[] = [];
  #linked = new Set<string>(); // modules whose hooks have run (imported ⊇ linked)
  #declared = new Set<string>(); // came from add(), i.e. the application itself — not uninstallable
  #installed: Record<string, number> = {}; // name → time install() ran; the `module` table in memory
  #failed: Record<string, string> = {}; // installed but not importable this boot → name: why
  #booting = false; // inside init(): install() only registers, the link pass follows

  /** Where to find a module that nobody declared. Set by whoever knows a catalog — the StoreManager
   *  does it — so this manager keeps knowing only that a module is a URL, and needs no store. */
  locate: (name: string) => Promise<string | undefined> = async () => undefined;

  constructor(app: App) {
    this.#app = app;
  }

  get(name: string): Module | undefined { return this.#modules[name]; }

  all(): Record<string, Module> { return this.#modules; }

  // True once a module's hooks have run (imported ⊇ linked). Unlink flips it back.
  linked(name: string): boolean { return this.#linked.has(name); }

  // True for modules the application declares itself — they outlive any uninstall.
  declared(name: string): boolean { return this.#declared.has(name); }

  // Installed modules that could not be imported this boot, and why; uninstall() is the way out.
  failures(): Record<string, string> { return this.#failed; }

  /** The order everything runs in: dependencies before dependents. A module's index is its position. */
  order(): string[] { return this.#order(); }

  /** Declare a module for import during app.init(). A relative string resolves against appPATH —
   *  pass `new URL("./x/plugin.ts", import.meta.url)` for "relative to this source file". */
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
    // The manifest is read, not imported: what a store needs to know must not require running code.
    const manifest = await readManifest(source);
    if (manifest.name !== undefined && (typeof manifest.name !== "string" || !manifest.name)) throw new Error(`Manifest of ${source} has an invalid name`);
    const inferredName = /\/([^/?#]+)\/plugin\.(?:ts|js)(?:[?#].*)?$/.exec(source)?.[1];
    const name = expectedName ?? manifest.name ?? (inferredName && decodeURIComponent(inferredName));
    if (!name) throw new Error(`Module name cannot be inferred: ${source}`);
    if (!isModuleName(name)) throw new Error(`Invalid module name "${name}": ${source}`);
    if (expectedName && manifest.name && expectedName !== manifest.name)
      throw new Error(`Module name mismatch: store has "${expectedName}", manifest says "${manifest.name}"`);
    const existing = this.#modules[name];
    if (existing) {
      if (existing.source !== source) throw new Error(`Duplicate module name "${name}": ${existing.source} vs ${source}`);
      return existing;
    }

    const same = Object.values(this.#modules).find((mod) => mod.source === source);
    if (same) throw new Error(`Plugin ${source} is already registered as "${same.name}"`);

    const plugin = await import(source);
    const mod = new Module(this.#app, name, plugin, manifest, source);
    this.#modules[name] = mod;
    return mod;
  }

  async init(): Promise<void> {
    for (const { spec, name } of this.#pending) await this.import(spec, name);
    this.#pending = [];
    this.#declared = new Set(Object.keys(this.#modules));
    // Chicken-and-egg: `url` says which modules to import, but importing them is what completes the
    // schema this table is migrated to. So read it before its own migration — as it is, since a fresh
    // database has no table and an install older than the column has no `url`.
    const rows = await this.#app.db.query`SELECT * FROM module`.catch(() => []);
    for (const { name, url, installed } of rows) {
      if (installed) this.#installed[name] = installed;
      if (!url || this.#modules[name]) continue;
      // A deleted folder or an unreachable host must not keep the app from booting: shout, skip,
      // and let the module page offer the uninstall that clears the row.
      await this.import(url, name).catch((e) => {
        this.#failed[name] = errMsg(e);
        console.error(`Module "${name}" is installed but could not be imported from ${url}:`, e);
      });
    }
    await this.#importDependencies();
    this.#skipMissing();
    // In passes: an install() hook may install further modules (a bundle bringing its set), and
    // those need the same ordering and schema merge as the first round, not a nested link().
    this.#booting = true;
    try {
      for (let count = 0; count !== Object.keys(this.#modules).length;) {
        count = Object.keys(this.#modules).length;
        const order = this.#order();
        await this.#applyDbSchema(order);
        this.#applySchemas(order);
        for (const name of order) if (!this.#linked.has(name)) await this.#linkOne(this.#modules[name]);
      }
    } finally { this.#booting = false; }
  }

  /** Import, remember and link a module — the persistent counterpart of add(). */
  async install(spec: string, name?: string): Promise<Module> {
    const mod = await this.import(spec, name);
    // A locatable dependency is installed along, deepest first — asking someone to install five
    // modules in the right order by hand is a worse answer than doing it. What cannot be found is
    // an error: an unorderable module would break the next boot, so it must not reach the table.
    try {
      for (const need of mod.dependencies) {
        if (this.#modules[need]) continue;
        const url = await this.locate(need);
        if (!url) throw new Error(`Cannot install "${mod.name}": needs ${need}`);
        await this.install(url, need);
      }
    } catch (e) {
      delete this.#modules[mod.name]; // nothing half-registered
      throw e;
    }
    await this.#app.db.table("module").ensure({ name: mod.name, url: mod.source });
    if (!this.#booting) {
      await this.link(mod.name); // during boot init() links it in a later pass
      for (const name of Object.keys(this.#failed)) await this.link(name).then(() => delete this.#failed[name], () => {});
    }
    return mod;
  }

  /** Run install() again — the hooks are written to fill gaps, so this restores what was deleted.
   *  It does not touch what was changed: a seed guarded by "does this exist?" skips what is there. */
  async repair(name: string): Promise<void> {
    const mod = this.#modules[name];
    if (!mod || !this.#linked.has(name)) throw new Error(`Cannot repair "${name}": not linked`);
    await mod.plugin.install?.({ app: this.#app, module: mod.plugin });
    this.#installed[name] = unixTime();
    await this.#app.db.table("module").ensure({ name, installed: this.#installed[name] });
  }

  /** Back to factory: let the module remove what it owns, then install it again. Needs an
   *  uninstall() hook — without one there is nothing to undo and repair() is the honest option. */
  async reset(name: string): Promise<void> {
    const mod = this.#modules[name];
    if (!mod || !this.#linked.has(name)) throw new Error(`Cannot reset "${name}": not linked`);
    if (!mod.plugin.uninstall) throw new Error(`Cannot reset "${name}": the module has no uninstall()`);
    await mod.plugin.uninstall({ app: this.#app, module: mod.plugin });
    await this.repair(name);
  }

  /** Unlink, let the module clean up after itself and forget it. Its data goes, unlink() keeps it. */
  async uninstall(name: string): Promise<void> {
    if (this.#declared.has(name)) throw new Error(`Cannot uninstall "${name}": the application declares it`);
    const mod = this.#modules[name];
    if (!mod && !await this.#app.db.table("module").get(name)) throw new Error(`Cannot uninstall "${name}": unknown`);
    if (mod) { // a leftover row has no hooks to reverse and no plugin to ask — only the row goes
      this.unlink(name);
      await mod.plugin.uninstall?.({ app: this.#app, module: mod.plugin });
    }
    await this.#app.db.table("module").delete(name);
    delete this.#installed[name];
    delete this.#failed[name];
    delete this.#modules[name];
  }

  /** Same module, other source: where its code comes from changes, what it owns stays. Throws like
   *  unlink() while something linked depends on it. The row is written last, so a failed import
   *  leaves it pointing at the source that worked and the next boot is back where it started. */
  async relocate(name: string, url: string): Promise<void> {
    if (this.#declared.has(name)) throw new Error(`Cannot relocate "${name}": the application declares it`);
    if (!this.#modules[name]) throw new Error(`Cannot relocate "${name}": not imported`); // never an install in disguise
    const linked = this.#linked.has(name); // unlink() forgets it, and a deactivated module stays deactivated
    this.unlink(name);
    delete this.#modules[name]; // import() refuses a name it already holds
    await this.import(url, name);
    if (linked) await this.link(name);
    await this.#app.db.table("module").ensure({ name, url });
  }

  // Run a registered module's hooks at runtime. Idempotent; its dependencies must already be linked.
  async link(name: string): Promise<void> {
    const mod = this.#modules[name];
    if (!mod) throw new Error(`Cannot link "${name}": not imported`);
    if (this.#linked.has(name)) return;
    for (const need of mod.dependencies)
      if (!this.#linked.has(need)) throw new Error(`Cannot link "${name}": needs "${need}", which is not linked`);
    const order = this.#order([...this.#linked, name]);
    await this.#applyDbSchema(order);
    this.#applySchemas(order);
    await this.#linkOne(mod);
  }

  // Reverse a module's hooks. Stays registered (re-linkable); tables, locales and install content (data) remain.
  unlink(name: string): void {
    const mod = this.#modules[name];
    if (!mod || !this.#linked.has(name)) return;
    for (const other of Object.values(this.#modules))
      if (other !== mod && this.#linked.has(other.name) && other.dependencies.includes(name))
        throw new Error(`Cannot unlink "${name}": "${other.name}" needs it`);
    mod.abort(); // fires the signal init() registered its listeners/timers with
    delete this.#app.apiTree[name];
    this.#linked.delete(name);
    this.#applySchemas(this.#order([...this.#linked]));
  }

  // Per-module hooks: registers everything init() sets up for one module.
  async #linkOne(mod: Module): Promise<void> {
    const { plugin } = mod;
    try {
      await plugin.init?.(this.#app, { signal: mod.newSignal() });
      if (!this.#installed[mod.name]) {
        await plugin.install?.({ app: this.#app, module: plugin });
        const installed = unixTime();
        await this.#app.db.table("module").ensure({ name: mod.name, installed }); // db row first: the memo must not outlive a failed write
        this.#installed[mod.name] = installed;
      }
      await this.#loadLocales(mod);
      if (plugin.api) this.#app.apiTree[mod.name] = plugin.api;
      this.#linked.add(mod.name);
    } catch (e) { mod.abort(); throw e; } // roll back what init() registered with the signal
  }

  // Rebuild app/ctx settings schema from the given (dependency-ordered) modules and re-apply defaults.
  #applySchemas(order: string[]): void {
    const appSettingsSchema = { properties: {} as Record<string, unknown> };
    const ctxSettingsSchema = { properties: {} as Record<string, unknown> };
    for (const name of order) {
      const { plugin } = this.#modules[name];
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
    const schemas = order.map((name) => this.#modules[name].plugin.dbSchema);
    for (const schema of schemas) if (typeof schema !== "function") mergeSchema(dbSchema, schema);
    // Function-form dbSchema runs after the static merge — for tables derived from other modules.
    for (const schema of schemas) if (typeof schema === "function") mergeSchema(dbSchema, schema(dbSchema));
    if (Object.keys(dbSchema.properties).length) {
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
      for await (const e of Deno.readDir(dir + "locale/")) {
        const m = e.name.match(/^([a-z]{2})\.json$/);
        if (m) await this.#app.languages.import(m[1], ns, await Deno.readTextFile(dir + "locale/" + e.name));
      }
    } catch (e) { /* module has no locale dir */
      if (!(e instanceof Deno.errors.NotFound)) console.error(`locale import failed for module "${mod.name}":`, e);
    }
  }

  // An installed module may outlive a removed dependency: expose it as broken and keep booting.
  /** Import what the declared modules need. An application says what it wants; the manifest names
   *  the rest and locate() knows where it lives, so nobody has to write out the closure by hand.
   *  What cannot be located stays missing — #skipMissing() and #order() report it as before. */
  async #importDependencies(): Promise<void> {
    const tried = new Set<string>();
    // One at a time: a module brings its own dependencies, which the next round picks up.
    const next = () => Object.values(this.#modules).flatMap((mod) => mod.dependencies)
      .find((need) => !this.#modules[need] && !tried.has(need));
    for (let need = next(); need; need = next()) {
      tried.add(need);
      const url = await this.locate(need);
      if (!url) continue; // unresolvable: leave the reporting to #skipMissing()
      await this.import(url, need).catch((e) => {
        this.#failed[need] = errMsg(e);
        console.error(`Module "${need}" is needed but could not be imported from ${url}:`, e);
      });
    }
  }

  #skipMissing(): void {
    const gone = (need: string) => !this.#modules[need] || this.#failed[need];
    // Marking one module broken can break its dependents, so sweep until a pass changes nothing.
    for (let again = true; again;) {
      again = false;
      for (const mod of Object.values(this.#modules)) {
        if (this.#declared.has(mod.name) || this.#failed[mod.name]) continue;
        const need = mod.dependencies.find(gone);
        if (!need) continue;
        const why = `Module "${mod.name}" needs "${need}", but it is not imported`;
        this.#failed[mod.name] = why;
        console.error(`${why}; skipping installed module`);
        again = true;
      }
    }
  }

  // Dependency-ordered subset (default: all imported). Recurses dependencies only within the set.
  #order(names: string[] = Object.keys(this.#modules).filter((name) => !this.#failed[name])): string[] {
    const order: string[] = [];
    const seen: Record<string, "visiting" | "done"> = {};
    const set = new Set(names);
    const visit = (name: string) => {
      if (seen[name] === "done") return;
      if (seen[name] === "visiting") throw new Error(`Circular module dependency: ${name}`);
      const mod = this.#modules[name];
      if (!mod) throw new Error(`Module "${name}" is not imported`);
      seen[name] = "visiting";
      for (const need of mod.dependencies) {
        if (!this.#modules[need]) throw new Error(`Module "${name}" needs "${need}", but it is not imported`);
        if (set.has(need)) visit(need);
      }
      seen[name] = "done";
      order.push(name);
    };
    for (const name of names) visit(name);
    return order;
  }

}
