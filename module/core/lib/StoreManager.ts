import { fromFileUrl } from "../deps.ts";
import { fs } from "./fs.ts";
import { isModuleName, readManifest, resolveSpecifier } from "./ModuleManager.ts";

import type { App } from "./App.ts";
import type { Manifest, Module } from "./ModuleManager.ts";

/** A folder store: its subfolders that contain a plugin file. */
async function readFolder(url: string): Promise<string[]> {
  // HTTP directory listings are unreliable, so remote stores need a catalog.
  if (!url.startsWith("file:")) throw new Error(`Store ${url}: a folder store is local only, a remote store needs a store.json`);
  const dir = fromFileUrl(url);
  const names = [];
  for (const e of await fs.list(dir))
    if (e.isDirectory && isModuleName(e.name) && await fs.isFile(`${dir}${e.name}/plugin.ts`)) names.push(e.name);
  return names.sort();
}

/** The catalog's module names, sorted; validates the format. */
async function readCatalog(url: string): Promise<string[]> {
  const res = await fetch(url); // works for file: and http(s):
  if (!res.ok) throw new Error(`Store ${url}: ${res.status} ${res.statusText}`);
  const modules = (await res.json())?.modules;
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) throw new Error(`Store ${url}: modules must be an object`);
  for (const [name, meta] of Object.entries(modules)) {
    if (!isModuleName(name)) throw new Error(`Store ${url}: invalid module name "${name}"`);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error(`Store ${url}: module "${name}" metadata must be an object`);
  }
  return Object.keys(modules).sort();
}

export class Store {
  #app: App;
  #url: string;
  #declared: boolean;

  constructor(app: App, url: string, declared: boolean) {
    this.#app = app;
    this.#url = url;
    this.#declared = declared;
  }

  /** URL of the store: its catalog file, or the folder itself. */
  get url(): string { return this.#url; }
  /** Directory of the store; all its modules are below it. */
  get base(): string { return new URL(".", this.#url).href; }
  /** Base URL; each module is in a subfolder named after it. */
  moduleUrl(name: string): string { return `${this.base}${name}/plugin.ts`; }

  /** True if declared by the application itself — can't be uninstalled. */
  get declared(): boolean { return this.#declared; }

  /** Read the module names — trailing slash = folder, else catalog. Not cached, since a store may
   *  get new modules while the app runs. */
  names(): Promise<string[]> { return (this.#url.endsWith("/") ? readFolder : readCatalog)(this.#url); }

  /** A module's manifest (mainly its dependencies), without importing it. */
  manifest(name: string): Promise<Manifest> {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    return readManifest(this.moduleUrl(name));
  }

  /** Register one module; its URL follows from the name, so no catalog is read. */
  add(name: string): this {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    this.#app.modules.add(this.moduleUrl(name), name);
    return this;
  }

  /** Install one module — the persistent version of add(). The URL comes from the store, so
   *  callers that take a name never handle a URL. */
  install(name: string): Promise<Module> {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    return this.#app.modules.install(this.moduleUrl(name), name);
  }

  /** Register every module of the catalog: names() + add(). */
  async addAll(): Promise<this> {
    for (const name of await this.names()) this.add(name);
    return this;
  }
}

export class StoreManager {
  #app: App;
  #stores = new Map<string, Store>();

  constructor(app: App) {
    this.#app = app;
    // Stores know where modules are; the module manager doesn't, so it gets this hook. Keeps the
    // dependency one-way.
    app.modules.locate = async (name) => (await this.offers()).get(name)?.moduleUrl(name);
  }

  all(): Store[] { return [...this.#stores.values()]; }

  get(url: string): Store | undefined { return this.#stores.get(url); }

  /** Which store offers which module — one read per store, first registered wins. Unreadable
   *  stores are skipped. */
  async offers(): Promise<Map<string, Store>> {
    const stores = this.all();
    const lists = await Promise.all(stores.map((store) => store.names().catch(() => []))); // in parallel
    const found = new Map<string, Store>();
    for (const [i, names] of lists.entries()) for (const name of names) if (!found.has(name)) found.set(name, stores[i]);
    return found;
  }

  #ensure(url: string, declared: boolean) {
    return this.#stores.getOrInsertComputed(url, () => new Store(this.#app, url, declared));
  }

  add(spec: string | URL): Store {
    return this.#ensure(resolveSpecifier(this.#app, spec), true);
  }

  /** Keep a store across restarts — the persistent version of add(). */
  async install(spec: string | URL): Promise<Store> {
    const url = resolveSpecifier(this.#app, spec);
    if (!this.#stores.has(url)) {
      await new Store(this.#app, url, false).names(); // throws if unreadable
      await this.#app.db.table("store").insert({ url });
    }
    return this.#ensure(url, false);
  }

  async uninstall(url: string): Promise<void> {
    const store = this.#stores.get(url);
    if (!store) throw new Error(`Cannot uninstall store "${url}": unknown`);
    if (store.declared) throw new Error(`Cannot uninstall store "${url}": the application declares it`);
    await this.#app.db.table("store").delete(url);
    this.#stores.delete(url);
  }

  /** Register the saved stores, so the backend can list and install from them. */
  async init(): Promise<void> {
    // Read before migration, like ModuleManager.init().
    for (const { url } of await this.#app.db.query`SELECT * FROM store`.catch(() => []))
      if (url) this.#ensure(url, false);
  }
}
