import { Emitter, errMsg, sql, toJsonSchema, toTools, walk } from "@qino/qino";
import { collection, index, remove, search } from "@qino/qino/ai1.embed";

import type { App, Ctx } from "@qino/qino";

// What the app is made of, for whoever builds on it, e.g. an AI: its tables, events and tools, each by
// name with a description, its details on demand, and findable by meaning.

export type Kind = "tables" | "events" | "tools";
/** `text` is what a search finds it by: name, description and its fields. */
export type Entry = { name: string; description: string; text: string; detail: unknown };

type Schema = { description?: string; type?: unknown; "x-qg-parent"?: string; properties?: Record<string, Schema> };
type Table = Schema & { additionalProperties?: Schema };

/** How many hits a search gives. */
const LIMIT = 10; // todo? adjustable

const log = (e: unknown) => console.error("[ai1.discover] embedding:", errMsg(e));

/** An entry; its text is a line for itself, one per field. */
const entry = (name: string, description = "", fields: Record<string, Schema> = {}, detail: unknown): Entry => ({
  name, description, detail,
  text: [
    description ? `${name}: ${description}` : name,
    ...Object.entries(fields).map(([field, { type, description, "x-qg-parent": parent }]) =>
      `- ${field}${type ? ` (${type}${parent ? ` → ${parent}` : ""})` : ""}${description ? `: ${description}` : ""}`),
  ].join("\n"),
});

const tables = (app: App): Entry[] => Object.entries(app.db.schema.properties as Record<string, Table>)
  .map(([name, table]) => entry(name, table.description, table.additionalProperties?.properties, table));

/** Events as `host:event`, the hosts being the app and its emitters (`db`). */
const events = (app: App): Entry[] =>
  Object.entries({ app, ...Object.fromEntries(Object.entries(app).filter(([, v]) => v instanceof Emitter)) })
    .flatMap(([host, emitter]) => Object.entries((emitter.constructor as typeof Emitter).events)
      .map(([event, { description, data }]) => {
        const schema = toJsonSchema(data) as Schema;
        return entry(`${host}:${event}`, description, schema.properties, { description, data: schema });
      }));

const tools = (app: App): Entry[] => toTools(app.apiTree).map(({ name, description, parameters }) =>
  entry(name, description, (parameters as Schema).properties, { name, description, parameters }));

/** The tools `ctx` may call, by name. */
async function callable(ctx: Ctx): Promise<Set<string>> {
  const names = new Set<string>();
  for (const r of walk(ctx.app.apiTree)) if (r.verb.access && await r.verb.access(ctx)) names.add(r.name);
  return names;
}

/** The entries of a kind `ctx` may see: tables and events all, tools only those it may call. */
export async function entries(ctx: Ctx, kind: Kind): Promise<Entry[]> {
  if (kind === "tables") return tables(ctx.app);
  if (kind === "events") return events(ctx.app);
  const names = await callable(ctx);
  return tools(ctx.app).filter((tool) => names.has(tool.name));
}

const indexed = new WeakMap<App, Map<Kind, { text: string; done: Promise<void> }>>();

/** Embed every entry of a kind, unless it is as last time: modules linked later change it. Unchanged
 *  entries are not embedded again (ai1.embed); those gone are removed. */
function indexAll(app: App, kind: Kind, all: Entry[]): Promise<void> {
  const kinds = indexed.get(app) ?? indexed.set(app, new Map()).get(app)!;
  const now = all.map((e) => e.text).join("\n\n");
  if (kinds.get(kind)?.text === now) return kinds.get(kind)!.done;
  const done = (async () => {
    for (const { name, text } of all) await index(app, "ai1_discover", { kind, name }, text);
    const names = new Set(all.map((e) => e.name));
    for (const name of await app.db.col`SELECT DISTINCT name FROM embedding_ai1_discover WHERE kind = ${kind}`) {
      if (!names.has(String(name))) await remove(app, "ai1_discover", { kind, name: String(name) });
    }
  })().catch((e) => { kinds.delete(kind); throw e; }); // tried again by the next search
  kinds.set(kind, { text: now, done });
  return done;
}

/** The entries nearest to `query` by meaning; without an embedding collection those that contain the
 *  most of its words. */
export async function find(ctx: Ctx, kind: Kind, query: string): Promise<Entry[]> {
  const app = ctx.app, mine = await entries(ctx, kind);
  if (!await collection(app)) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return mine.map((e) => ({ e, n: words.filter((w) => e.text.toLowerCase().includes(w)).length }))
      .filter(({ n }) => n).sort((a, b) => b.n - a.n).slice(0, LIMIT).map(({ e }) => e);
  }
  await indexAll(app, kind, kind === "tools" ? tools(app) : mine).catch(log);
  // a few more, as some may not be the caller's (tools) or be chunks of the same entry
  const hits = await search(app, { ai1_discover: sql`e.kind = ${kind}` }, query, { limit: LIMIT * 5 });
  const byName = new Map(mine.map((e) => [e.name, e]));
  return [...new Set(hits.map((h) => String(h.key.name)))].flatMap((name) => byName.get(name) ?? []).slice(0, LIMIT);
}
