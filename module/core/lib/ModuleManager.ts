// deno-lint-ignore-file no-explicit-any
import { fromFileUrl, isAbsolute, toFileUrl, $item } from "../../../deps.ts";
import type { App } from "./App.ts";
import { getCtx } from "./ctx/Ctx.ts";
import { enableItemSchemaDefaults } from "./util.ts";

type DbSchema = { properties: Record<string, unknown> };

export type Plugin = Record<string, any> & {
  name: string;
  needs?: string[];
  // Object = static schema. Function = computed from the merged schema (runs after all
  // static ones), e.g. for tables derived from other modules' tables.
  dbSchema?: DbSchema | ((merged: DbSchema) => DbSchema);
  init?(app: App, opts: { signal: AbortSignal }): void | Promise<void>;
  install?(ctx: { app: App; module: Plugin }): void | Promise<void>;
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
  #plugin: Plugin;
  #url: string;
  #path: string | undefined;
  #abort = new AbortController();

  constructor(app: App, plugin: Plugin, url: string, path?: string) {
    this.#app = app;
    this.#plugin = plugin;
    this.#url = url;
    this.#path = path;
  }
  get name(): string { return this.#plugin.name; }
  get plugin(): Plugin { return this.#plugin; }
  get url(): string { return this.#url; }
  get path(): string | undefined { return this.#path; }
  get dir(): string | undefined { return this.path?.replace(/\/[^/]+$/, "/"); }
  /** Where the app keeps its own files for this module; what lies in pub/ is served. */
  get appDir(): string { return `${this.#app.appPATH}qg/${this.name}/`; }
  /** The same dir as a URL. */
  get appUrl(): string { return `${getCtx().req.basePath}qg/${this.name}/`; }
  // Fresh signal per (re-)link; abort() on unlink tears down what init() registered with it.
  newSignal(): AbortSignal { return (this.#abort = new AbortController()).signal; }
  abort(): void { this.#abort.abort(); }
  toString(): string { return this.name; }
}

async function fileExists(path: string): Promise<boolean> {
  return (await Deno.stat(path).catch(() => null))?.isFile ?? false;
}

export class ModuleManager {
  #app: App;
  #modules: Record<string, Module> = {};
  #linked = new Set<string>(); // modules whose hooks have run (imported ⊇ linked)

  constructor(app: App) {
    this.#app = app;
  }

  get(name: string): Module | undefined { return this.#modules[name]; }

  all(): Record<string, Module> { return this.#modules; }

  // True once a module's hooks have run (imported ⊇ linked). Unlink flips it back.
  linked(name: string): boolean { return this.#linked.has(name); }

  async import(spec: string): Promise<Module> {
    if (spec.startsWith("./") || spec.startsWith("../")) throw new Error(`Relative module specifier "${spec}" is not supported. Use app.import(import.meta.resolve("${spec}"))`);
    if (spec.endsWith("/")) throw new Error(`Plugin import needs a file, not a directory: ${spec}`);
    if (!/\/plugin\.(?:ts|js|mjs)(?:[?#].*)?$/.test(spec)) throw new Error(`Plugin import needs a plugin.ts, plugin.js, or plugin.mjs file: ${spec}`);
    const path = spec.startsWith("file:") ? fromFileUrl(spec) : isAbsolute(spec) ? spec : undefined;
    const url = path ? toFileUrl(path).href : spec;
    const plugin = await import(url);
    const name = plugin.name;
    if (typeof name !== "string" || !name) throw new Error(`Plugin has no exported name: ${url}`);
    const existing = this.#modules[name];
    if (existing) {
      if (existing.url !== url) throw new Error(`Duplicate module name "${name}": ${existing.url} vs ${url}`);
      return existing;
    }

    if (!Array.isArray(plugin.needs ?? [])) throw new Error(`Plugin ${name}: exported needs must be an array`);

    const mod = new Module(this.#app, plugin, url, path);
    this.#modules[name] = mod;
    return mod;
  }

  async importAll(dir: string): Promise<void> {
    const base = (dir.startsWith("file:") ? fromFileUrl(dir) : dir).replace(/\/?$/, "/");
    const entries: string[] = [];
    for await (const entry of Deno.readDir(base)) {
      if (!entry.name.startsWith(".") && entry.isDirectory) entries.push(entry.name);
    }
    entries.sort();
    for (const name of entries) {
      const dir = base + name + "/";
      if (await fileExists(dir + "plugin.ts")) await this.import(dir + "plugin.ts");
      else if (await fileExists(dir + "plugin.js")) await this.import(dir + "plugin.js");
      else if (await fileExists(dir + "plugin.mjs")) await this.import(dir + "plugin.mjs");
    }
  }

  async init(): Promise<void> {
    const order = this.#order();
    await this.#applyDbSchema(order);
    this.#applySchemas(order);
    for (const name of order) await this.#linkOne(this.#modules[name]);
  }

  // Run a registered module's hooks at runtime. Idempotent; its needs must already be linked.
  async link(name: string): Promise<void> {
    const mod = this.#modules[name];
    if (!mod) throw new Error(`Cannot link "${name}": not imported`);
    if (this.#linked.has(name)) return;
    for (const need of mod.plugin.needs ?? [])
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
      if (other !== mod && this.#linked.has(other.name) && (other.plugin.needs ?? []).includes(name))
        throw new Error(`Cannot unlink "${name}": "${other.name}" needs it`);
    mod.abort(); // fires the signal init() registered its listeners/timers with
    delete this.#app.aptTree[name];
    this.#linked.delete(name);
    this.#applySchemas(this.#order([...this.#linked]));
  }

  // Per-module hooks: registers everything init() sets up for one module.
  async #linkOne(mod: Module): Promise<void> {
    const { plugin } = mod;
    await plugin.init?.(this.#app, { signal: mod.newSignal() });
    await plugin.install?.({ app: this.#app, module: plugin });
    await this.#loadLocales(mod);
    if (plugin.api) this.#app.aptTree[mod.name] = plugin.api;
    this.#linked.add(mod.name);
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
    for (const name of order) {
      const { plugin } = this.#modules[name];
      if (typeof plugin.dbSchema !== "function") mergeSchema(dbSchema, plugin.dbSchema);
    }
    // Function-form dbSchema runs after the static merge — for tables derived from other modules.
    for (const name of order) {
      const { plugin } = this.#modules[name];
      if (typeof plugin.dbSchema === "function") mergeSchema(dbSchema, plugin.dbSchema(dbSchema));
    }
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

  // Dependency-ordered subset (default: all imported). Recurses needs only within the set.
  #order(names: string[] = Object.keys(this.#modules)): string[] {
    const order: string[] = [];
    const seen: Record<string, "visiting" | "done"> = {};
    const set = new Set(names);
    const visit = (name: string) => {
      if (seen[name] === "done") return;
      if (seen[name] === "visiting") throw new Error(`Circular module dependency: ${name}`);
      const mod = this.#modules[name];
      if (!mod) throw new Error(`Module "${name}" is not imported`);
      seen[name] = "visiting";
      for (const need of mod.plugin.needs ?? []) {
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
