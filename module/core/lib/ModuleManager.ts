// deno-lint-ignore-file no-explicit-any
import { fromFileUrl, isAbsolute, toFileUrl, $item } from "../../../deps.ts";
import type { App } from "./App.ts";

export type Plugin = Record<string, any> & {
  name: string;
  needs?: string[];
  dbSchema?: Record<string, unknown>;
  init?(app: App): void | Promise<void>;
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
  readonly name: string;
  readonly url: string;
  readonly path: string | undefined;
  readonly plugin: Plugin;

  constructor(plugin: Plugin, url: string, path?: string) {
    this.name = plugin.name;
    this.url = url;
    this.path = path;
    this.plugin = plugin;
  }
  get dir(): string | undefined { return this.path?.replace(/\/[^/]+$/, "/"); }
  toString(): string { return this.name; }
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await Deno.stat(path)).isFile; }
  catch { return false; }
}

export class ModuleManager {
  #app: App;
  #modules: Record<string, Module> = {};

  constructor(app: App) {
    this.#app = app;
  }

  get(name: string): Module | undefined { return this.#modules[name]; }

  all(): Record<string, Module> { return this.#modules; }

  async import(spec: string): Promise<Module> {
    if (spec.startsWith("./") || spec.startsWith("../")) throw new Error(`Relative module specifier "${spec}" is not supported. Use app.import(import.meta.resolve("${spec}"))`);
    if (spec.endsWith("/")) throw new Error(`Plugin import needs a file, not a directory: ${spec}`);
    if (!/\/plugin\.(?:ts|js|mjs)(?:[?#].*)?$/.test(spec)) throw new Error(`Plugin import needs a plugin.ts, plugin.js, or plugin.mjs file: ${spec}`);
    const path = spec.startsWith("file:") ? fromFileUrl(spec) : isAbsolute(spec) ? spec : undefined;
    const url = path ? toFileUrl(path).href : spec;
    const plugin = await import(url);
    const name = plugin.name;
    if (typeof name !== "string" || !name) throw new Error(`Plugin has no exported name: ${url}`);
    if (this.#modules[name]) return this.#modules[name];

    if (!Array.isArray(plugin.needs ?? [])) throw new Error(`Plugin ${name}: exported needs must be an array`);

    const mod = new Module(plugin, url, path);
    this.#modules[name] = mod;
    return mod;
  }

  async importAll(path:string): Promise<void> {
    const base = (path.startsWith("file:") ? fromFileUrl(path) : path).replace(/\/?$/, "/");
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
    const appSettingsSchema = { properties: {} as Record<string, unknown> };
    const ctxSettingsSchema = { properties: {} as Record<string, unknown> };
    const order = this.#initOrder();
    const dbSchema = { properties: {} };
    for (const name of order) {
      const { plugin } = this.#modules[name];
      appSettingsSchema.properties[name] = plugin.settingsSchema;
      ctxSettingsSchema.properties[name] = plugin.ctxSettingsSchema;
      mergeSchema(dbSchema, plugin.dbSchema);
    }
    if (Object.keys(dbSchema.properties).length) {
      await this.#app.db.migrate(dbSchema, { patch: true });
      this.#app.db.schema = dbSchema;
      await this.#app.db.loadTables();
    }
    for (const name of order) {
      const { plugin } = this.#modules[name];
      await plugin.init?.(this.#app);
      await plugin.install?.({ app: this.#app, module: plugin });
      if (plugin.api) this.#app.aptTree[name] = plugin.api;
    }
    this.#app.settings[$item].setSchema(appSettingsSchema);
    this.#app.ctxSettingsSchema = ctxSettingsSchema;
    await this.#app.fire("init", { app: this.#app });
  }

  #initOrder(): string[] {
    const order: string[] = [];
    const seen: Record<string, "visiting" | "done"> = {};
    const visit = (name: string) => {
      if (seen[name] === "done") return;
      if (seen[name] === "visiting") throw new Error(`Circular module dependency: ${name}`);
      const mod = this.#modules[name];
      if (!mod) throw new Error(`Module "${name}" is not imported`);
      seen[name] = "visiting";
      for (const need of mod.plugin.needs ?? []) {
        if (!this.#modules[need]) throw new Error(`Module "${name}" needs "${need}", but it is not imported`);
        visit(need);
      }
      seen[name] = "done";
      order.push(name);
    };
    for (const name of Object.keys(this.#modules)) visit(name);
    return order;
  }

}
