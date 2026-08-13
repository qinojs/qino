import type { App } from "./App.ts";
import { fromFileUrl } from "../deps.ts";
import { isModuleName, type Manifest, type Module, readManifest, resolveSpecifier } from "./ModuleManager.ts";

/** A folder store lists itself: the subfolders holding the plugin file its URL would point at. */
async function readFolder(url: string): Promise<string[]> {
  // Some HTTP servers do serve an index, but parsing one is guesswork — remote stays catalog-only.
  if (!url.startsWith("file:")) throw new Error(`Store ${url}: a folder store is local only, a remote store needs a store.json`);
  const dir = fromFileUrl(url);
  const names = [];
  for await (const e of Deno.readDir(dir))
    if (e.isDirectory && isModuleName(e.name) && await Deno.stat(`${dir}${e.name}/plugin.ts`).then((s) => s.isFile, () => false)) names.push(e.name);
  return names.sort();
}

/** The catalog's module names, sorted — this is where the store format is validated. */
async function readCatalog(url: string): Promise<string[]> {
  const res = await fetch(url); // fetch reads file: and http(s): alike
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
  /** Directory the store lives in — every module of the store lies below it. */
  get base(): string { return new URL(".", this.#url).href; }
  /** The base is convention for both forms; a module lives below it under its own name. */
  moduleUrl(name: string): string { return `${this.base}${name}/plugin.ts`; }

  /** True for a store the application declares itself — it outlives any uninstall. */
  get declared(): boolean { return this.#declared; }

  /** Read the module names — a trailing slash is a folder, anything else a catalog. Not cached:
   *  a store may gain modules while the app runs. */
  names(): Promise<string[]> { return (this.#url.endsWith("/") ? readFolder : readCatalog)(this.#url); }

  /** What a module of this store says about itself, without importing it — its dependencies above all. */
  manifest(name: string): Promise<Manifest> {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    return readManifest(this.moduleUrl(name));
  }

  /** Declare one module of this store — its URL is conventional, so no catalog is read. */
  add(name: string): this {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    this.#app.modules.add(this.moduleUrl(name), name);
    return this;
  }

  /** Install one module of this store — the persistent counterpart of add(). Deriving the URL from
   *  the store is what keeps a caller that takes a module *name* from ever taking a URL. */
  install(name: string): Promise<Module> {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    return this.#app.modules.install(this.moduleUrl(name), name);
  }

  /** Declare every module in the catalog — nothing but names() + add(). */
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
    // Stores know where modules live, the module manager does not — so it is told, not asked. That
    // keeps the one dependency between the two pointing this way, as everywhere else here.
    app.modules.locate = async (name) => (await this.offers()).get(name)?.moduleUrl(name);
  }

  all(): Store[] { return [...this.#stores.values()]; }

  get(url: string): Store | undefined { return this.#stores.get(url); }

  /** Which store offers which module — one catalog read per store, first registration wins. An
   *  unreadable store contributes nothing instead of failing the lookup for all the others. */
  async offers(): Promise<Map<string, Store>> {
    const found = new Map<string, Store>();
    for (const store of this.all())
      for (const name of await store.names().catch(() => [])) if (!found.has(name)) found.set(name, store);
    return found;
  }

  #ensure(url: string, declared: boolean) {
    return this.#stores.getOrInsertComputed(url, () => new Store(this.#app, url, declared));
  }

  add(spec: string | URL): Store {
    return this.#ensure(resolveSpecifier(this.#app, spec), true);
  }

  /** Remember a store across restarts — the persistent counterpart of add(). */
  async install(spec: string | URL): Promise<Store> {
    const url = resolveSpecifier(this.#app, spec);
    if (!this.#stores.has(url)) {
      await new Store(this.#app, url, false).names(); // unreadable, no store
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

  /** Register the remembered stores, so the backend can list and install from them. */
  async init(): Promise<void> {
    // Same bootstrap read as ModuleManager.init(), before this table's own migration — take it as it is.
    for (const { url } of await this.#app.db.query`SELECT * FROM store`.catch(() => []))
      if (url) this.#ensure(url, false);
  }
}
