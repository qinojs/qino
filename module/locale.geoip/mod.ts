// Country of an IP address, from a table held in memory. Lookups never wait: until the table is
// loaded they answer undefined and start loading it in the background.
import { errMsg, fs } from "@qino/qino";

import { SOURCES } from "./lib/sources.ts";
import { slices, Table } from "./lib/table.ts";

import type { App } from "@qino/qino";

type Name = keyof typeof SOURCES;

/** Values of the `source` setting. */
export const NAMES = Object.keys(SOURCES) as Name[];

const HOUR = 3600_000;

// The tables are the same for every app: one per source and process.
const tables = new Map<Name, Table>();
const tried = new Map<Name, number>();

const sourceOf = async (app: App): Promise<Name> => {
  const name = String(await app.settings["locale.geoip"].source ?? "dbip");
  if (name in SOURCES) return name as Name;
  throw new Error(`locale.geoip: unknown source "${name}"`);
};
const dirOf = (app: App, name: Name) => `${app.dir}cache/locale.geoip/${name}/`;

/** Read the cached files (downloading what is missing) into a table. */
async function load(app: App, name: Name): Promise<Table> {
  const { files, parse } = SOURCES[name];
  const dir = dirOf(app, name);
  const table = new Table(), slice = slices();
  for (const [file, download] of Object.entries(files)) {
    if (!await fs.isFile(dir + file)) await store(dir + file, await download());
    for await (const line of lines(dir + file)) {
      parse(line, table);
      if (slice.due()) await slice.pause();
    }
  }
  return table.pack();
}

/** Written aside and moved, so a reader never sees half a file. */
async function store(path: string, body: ReadableStream<Uint8Array>) {
  await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
  const part = `${path}.part-${crypto.randomUUID()}`;
  await fs.write(part, body).catch(async (e) => {
    await fs.remove(part).catch(() => {});
    throw e;
  });
  await fs.rename(part, path);
}

/** A gzipped file line by line. */
async function* lines(path: string) {
  const gunzip = new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>;
  const text = (await fs.stream(path)).pipeThrough(gunzip).pipeThrough(new TextDecoderStream());
  let rest = "";
  for await (const chunk of text) {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest) yield rest;
}

export const geoip = {
  /** "CH" — undefined if unknown, or while the table is still loading. IPv6 counts by its /64 prefix. */
  async country(app: App, ip: string): Promise<string | undefined> {
    return (await geoip.lookup(app))(ip);
  },

  /** `country()` without waiting, for many addresses at once — e.g. while rendering a list. */
  async lookup(app: App): Promise<(ip: string) => string | undefined> {
    const name = await sourceOf(app);
    const table = tables.get(name);
    if (table) return (ip) => table.country(ip);
    // a failed load is tried again after an hour, not on every request
    if (performance.now() - (tried.get(name) ?? -HOUR) >= HOUR) {
      tried.set(name, performance.now());
      load(app, name).then((t) => tables.set(name, t), (e) => console.error("[locale.geoip]", errMsg(e)));
    }
    return () => undefined;
  },

  /** Fetch the source's files anew and swap the table. */
  async update(app: App): Promise<{ v4: number; v6: number }> {
    const name = await sourceOf(app);
    const dir = dirOf(app, name);
    for (const [file, download] of Object.entries(SOURCES[name].files)) await store(dir + file, await download());
    const table = await load(app, name);
    tables.set(name, table);
    return table.size;
  },

  /** Ranges in memory, undefined while not loaded. */
  async size(app: App): Promise<{ v4: number; v6: number } | undefined> {
    return tables.get(await sourceOf(app))?.size;
  },

  /** When the cached files were fetched (ms), undefined if not yet. */
  async fetched(app: App): Promise<number | undefined> {
    const name = await sourceOf(app);
    return fs.mtime(dirOf(app, name) + Object.keys(SOURCES[name].files)[0]);
  },
};
