import { fromFileUrl } from "../../../deps.ts";
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
  #selected = new Set<string>();
  #all = false;

  constructor(app: App, url: string) {
    this.#app = app;
    this.#url = url;
  }

  get url(): string { return this.#url; }

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

  add(spec: string | URL): Store {
    const url = resolveSpecifier(this.#app, spec);
    let store = this.#stores.get(url);
    if (!store) this.#stores.set(url, store = new Store(this.#app, url));
    return store;
  }

  async init(): Promise<void> {
    for (const store of this.#stores.values()) await store.init();
  }
}
