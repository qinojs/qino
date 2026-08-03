import type { App } from "./App.ts";
import { isModuleName, resolveSpecifier } from "./ModuleManager.ts";

/** The catalog's module names, sorted — this is where the store format is validated. */
async function readCatalog(url: string): Promise<string[]> {
  const res = await fetch(url); // fetch reads file: and http(s): alike
  if (!res.ok) throw new Error(`Store ${url}: ${res.status} ${res.statusText}`);
  const modules = (await res.json())?.modules;
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) throw new Error(`Store ${url}: modules must be an object`);
  for (const [name, meta] of Object.entries(modules as Record<string, unknown>)) {
    if (!isModuleName(name)) throw new Error(`Store ${url}: invalid module name "${name}"`);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error(`Store ${url}: module "${name}" metadata must be an object`);
  }
  return Object.keys(modules).sort();
}

export class Store {
  #app: App;
  #url: string;
  #declared: boolean;
  #all = false;

  constructor(app: App, url: string, declared: boolean) {
    this.#app = app;
    this.#url = url;
    this.#declared = declared;
  }

  get url(): string { return this.#url; }
  /** True for a store the application declares itself — it outlives any uninstall. */
  get declared(): boolean { return this.#declared; }

  /** Declare one module of this store — its URL is conventional, so no catalog is read. */
  add(name: string): this {
    if (!isModuleName(name)) throw new Error(`Invalid module name: ${name}`);
    this.#app.modules.add(this.moduleUrl(name), name);
    return this;
  }

  addAll(): this {
    this.#all = true;
    return this;
  }

  /** Read the catalog. Not cached — a store may gain modules while the app runs. */
  names(): Promise<string[]> { return readCatalog(this.#url); }

  /** The catalog URL is the base; a module lives beside it under its own name. */
  moduleUrl(name: string): string { return new URL(`${name}/plugin.ts`, new URL(".", this.#url)).href; }

  /** Only addAll() needs the catalog; everything else was already declared by add(). */
  async init(): Promise<void> {
    if (!this.#all) return;
    for (const name of await this.names()) this.#app.modules.add(this.moduleUrl(name), name);
  }
}

export class StoreManager {
  #app: App;
  #stores = new Map<string, Store>();

  constructor(app: App) {
    this.#app = app;
  }

  all(): Store[] { return [...this.#stores.values()]; }

  get(url: string): Store | undefined { return this.#stores.get(url); }

  #ensure(url: string, declared: boolean): Store {
    let store = this.#stores.get(url);
    if (!store) this.#stores.set(url, store = new Store(this.#app, url, declared));
    return store;
  }

  add(spec: string | URL): Store {
    return this.#ensure(resolveSpecifier(this.#app, spec), true);
  }

  /** Remember a store across restarts — the persistent counterpart of add(). */
  async install(spec: string | URL): Promise<Store> {
    const url = resolveSpecifier(this.#app, spec);
    const known = this.#stores.get(url);
    if (known) return known;
    await readCatalog(url); // no catalog, no store
    await this.#app.db.table("store").insert({ url });
    return this.#ensure(url, false);
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
    for (const { url } of rows) if (url) this.#ensure(url, false);
    for (const store of this.#stores.values()) await store.init();
  }
}
