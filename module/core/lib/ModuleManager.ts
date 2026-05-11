// deno-lint-ignore-file no-explicit-any
import { fromFileUrl, isAbsolute, toFileUrl, $item } from "../../../deps.ts";
import { DbSchema } from "./DbSchema.ts";
import type { App } from "../server.ts";

export type ModuleExports = Record<string, any>;

export class Module {
  readonly name: string;
  readonly url: string;
  readonly path: string | undefined;
  readonly exports: ModuleExports;

  constructor(exports: ModuleExports, url: string, path?: string) {
    this.name = exports.name;
    this.url = url;
    this.path = path;
    this.exports = exports;
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

  get(name: string): Module | undefined {
    return this.#modules[name];
  }

  all(): Record<string, Module> {
    return this.#modules;
  }

  async import(spec: string): Promise<Module> {
    if (spec.startsWith("./") || spec.startsWith("../")) throw new Error(`Relative module specifier "${spec}" is not supported. Use app.import(import.meta.resolve("${spec}"))`);
    if (spec.endsWith("/")) throw new Error(`Module import needs a file, not a directory: ${spec}`);
    const path = spec.startsWith("file:") ? fromFileUrl(spec) : isAbsolute(spec) ? spec : undefined;
    const url = path ? toFileUrl(path).href : spec;
    const exports = await import(url);
    const name = exports.name;
    if (typeof name !== "string" || !name) throw new Error(`Module has no exported name: ${url}`);
    if (this.#modules[name]) return this.#modules[name];

    if (!Array.isArray(exports.needs ?? [])) throw new Error(`Module ${name}: exported needs must be an array`);

    const mod = new Module(exports, url, path);
    this.#modules[name] = mod;
    exports.routes?.(this.#app);
    return mod;
  }

  async add(spec: string): Promise<Module> {
    const mod = await this.import(spec);
    if (mod.exports.dbSchema) await new DbSchema(this.#app.db).check(mod.exports.dbSchema);
    await mod.exports.init?.(this.#app);
    await mod.exports.install?.({ app: this.#app, module: mod.exports });
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
      if (await fileExists(dir + "mod.ts")) await this.import(dir + "mod.ts");
      else if (await fileExists(dir + "mod.js")) await this.import(dir + "mod.js");
    }
  }

  async init(): Promise<void> {
    const appSettingsSchema = { properties: {} as Record<string, unknown> };
    const ctxSettingsSchema = { properties: {} as Record<string, unknown> };
    for (const name of this.#initOrder()) {
      const { exports } = this.#modules[name];
      appSettingsSchema.properties[name] = exports.settingsSchema;
      ctxSettingsSchema.properties[name] = exports.ctxSettingsSchema;
      if (exports.dbSchema) await new DbSchema(this.#app.db).check(exports.dbSchema);
      await exports.init?.(this.#app);
      await exports.install?.({ app: this.#app, module: exports });
    }
    (this.#app.settings as any)[$item].setSchema(appSettingsSchema);
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
      for (const need of mod.exports.needs ?? []) {
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
