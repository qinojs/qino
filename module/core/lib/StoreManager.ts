import { fromFileUrl } from "../deps.ts";
import type { App } from "./App.ts";
import { isModuleName, resolveSpecifier } from "./ModuleManager.ts";

async function read(url: string): Promise<unknown> {
  const protocol = new URL(url).protocol;
  if (protocol === "file:") return JSON.parse(await Deno.readTextFile(fromFileUrl(url)));
  if (protocol === "http:" || protocol === "https:") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Store ${url}: ${res.status} ${res.statusText}`);
    return await res.json();
  }
  throw new Error(`Store URL must use file, http, or https: ${url}`);
}

export class Store {
  #app: App;
  #url: string;
  #declared: boolean;
  #selected = new Set<string>();
  #all = false;

  constructor(app: App, url: string, declared: boolean) {
    this.#app = app;
    this.#url = url;
    this.#declared = declared;
  }

  get url(): string { return this.#url; }
  /** True for a store the application declares itself — it outlives any uninstall. */
  get declared(): boolean { return this.#declared; }

  add(name: string): this {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    this.#selected.add(name);
    return this;
  }

  addAll(): this {
    this.#all = true;
    return this;
  }

  async init(): Promise<void> {
    if (!this.#all && !this.#selected.size) return; // nothing declared for boot — the catalog is read on demand
    const data = await read(this.#url);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`Store ${this.#url}: root must be an object`);
    const modules = (data as { modules?: unknown }).modules;
    if (!modules || typeof modules !== "object" || Array.isArray(modules)) throw new Error(`Store ${this.#url}: modules must be an object`);

    const entries = modules as Record<string, unknown>;
    for (const [name, meta] of Object.entries(entries)) {
      if (!isModuleName(name)) throw new Error(`Store ${this.#url}: invalid module name "${name}"`);
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error(`Store ${this.#url}: module "${name}" metadata must be an object`);
    }
    for (const name of this.#selected)
      if (!Object.hasOwn(entries, name)) throw new Error(`Store ${this.#url}: module "${name}" does not exist`);

    const names = this.#all ? Object.keys(entries) : [...this.#selected];
    const base = new URL(".", this.#url);
    for (const name of names.sort()) this.#app.modules.add(new URL(`${name}/plugin.ts`, base).href, name);
  }
}

export class StoreManager {
  #app: App;
  #stores = new Map<string, Store>();

  constructor(app: App) {
    this.#app = app;
  }

  all(): Store[] { return [...this.#stores.values()]; }

  add(spec: string | URL): Store {
    const url = resolveSpecifier(this.#app, spec);
    let store = this.#stores.get(url);
    if (!store) this.#stores.set(url, store = new Store(this.#app, url, true));
    return store;
  }

  /** Remember a store across restarts — the persistent counterpart of add(). */
  async install(spec: string | URL): Promise<Store> {
    const url = resolveSpecifier(this.#app, spec);
    let store = this.#stores.get(url);
    if (store) return store;
    await this.#app.db.table("store").insert({ url });
    this.#stores.set(url, store = new Store(this.#app, url, false));
    return store;
  }

  async uninstall(url: string): Promise<void> {
    const store = this.#stores.get(url);
    if (!store) throw new Error(`Cannot uninstall store "${url}": unknown`);
    if (store.declared) throw new Error(`Cannot uninstall store "${url}": the application declares it`);
    await this.#app.db.table("store").delete(url);
    this.#stores.delete(url);
  }

  async init(): Promise<void> {
    // Same bootstrap read as ModuleManager.init(), before this table's own migration — take it as it is.
    const rows = await this.#app.db.query`SELECT * FROM store`.catch(() => []);
    for (const { url } of rows) if (url && !this.#stores.has(url)) this.#stores.set(url, new Store(this.#app, url, false));
    for (const store of this.#stores.values()) await store.init();
  }
}
