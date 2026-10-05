import { ApiError, NotFoundError } from "@qino/qino";

import { validate } from "@qino/item/tools/schema/validator.js";

import type { App } from "@qino/qino";

export { configure, datapoint, datapoints, value } from "./datapoint.ts";
export type { Datapoint } from "./datapoint.ts";

/** A logical endpoint, not necessarily a physical device. Values and attributes keep their types. */
export type Entity = {
  id: string;
  name: string;
  state: unknown;
  attributes: Record<string, unknown>;
  available: boolean;
  updated?: string;
  unit?: string;
};

/** Actions are discovered, never inferred from an entity's name or state. */
export type Action = {
  id: string;
  name: string;
  description?: string;
  fields?: Record<string, unknown>;
};

export type Call = { entities?: string[]; data?: Record<string, unknown> };

/** A linked adapter can serve any number of persisted provider instances. */
export type Adapter = {
  name: string;
  schema?: Record<string, unknown>;
  entities(app: App, provider: number): Promise<Entity[]>;
  actions(app: App, provider: number): Promise<Action[]>;
  call(app: App, provider: number, action: string, input: Call): Promise<unknown>;
  history?(app: App, provider: number, entity: string, period: { start: string; end: string }): Promise<Entity[]>;
};

export type Provider = { id: number; name: string; adapter: string; config: Record<string, unknown>; enabled: boolean };

/** Adapter names identify implementations; provider IDs identify configured connections. */
export function adapters(app: App): Adapter[] {
  const all = app.modules.linked().flatMap((mod) => mod.plugin.homeProvider ? [mod.plugin.homeProvider as Adapter] : []);
  if (new Set(all.map((adapter) => adapter.name)).size !== all.length) throw new Error("home: duplicate adapter names");
  return all;
}

export const adapter = (app: App, name: string): Adapter | undefined =>
  adapters(app).find((adapter) => adapter.name === name);

const decode = (row: Provider): Provider => ({
  ...row, id: Number(row.id), enabled: Boolean(row.enabled),
  config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
});

/** Trusted server access, including credentials. Public APIs redact write-only configuration. */
export async function providers(app: App): Promise<Provider[]> {
  return (await app.db.query<Provider>`SELECT * FROM home_provider ORDER BY id`).map(decode);
}

export async function provider(app: App, id: number): Promise<Provider> {
  const row = await app.db.row<Provider>`SELECT * FROM home_provider WHERE id = ${id}`;
  if (!row) throw new NotFoundError("Home provider was not found");
  return decode(row);
}

function readable(value: unknown, schema: Record<string, unknown>): unknown {
  if (schema.writeOnly) return undefined;
  if (Array.isArray(value)) return value.map((item) => readable(item, schema.items as Record<string, unknown> ?? {}));
  if (!value || typeof value !== "object") return value;
  const fields = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(value).flatMap(([key, value]) => {
    const child = readable(value, fields[key] ?? {});
    return child === undefined ? [] : [[key, child]];
  }));
}

/** Public view: write-only fields are removed, configuration of unlinked adapters is hidden entirely. */
export function redact(app: App, row: Provider): Provider {
  const schema = adapter(app, row.adapter)?.schema;
  return { ...row, config: schema ? readable(row.config, schema) as Record<string, unknown> : {} };
}

function merge(input: unknown, previous: unknown, schema: Record<string, unknown>): unknown {
  if (schema.writeOnly && input === "") return previous;
  if (Array.isArray(input)) {
    const items = schema.items as Record<string, unknown> ?? {};
    return input.map((item, index) => merge(item, Array.isArray(previous) ? previous[index] : undefined, items));
  }
  if (!schema.properties || !input || typeof input !== "object") return input;
  const old = previous && typeof previous === "object" ? previous as Record<string, unknown> : {};
  const fields = schema.properties as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(input))
    if (fields[key]?.readOnly) throw new ApiError(400, "Read-only provider configuration cannot be submitted");
  return { ...old, ...Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    const result = merge(value, old[key], fields[key] ?? {});
    return result === undefined ? [] : [[key, result]];
  })) };
}

/** Create or edit an instance; empty secret fields preserve stored credentials. */
export async function save(app: App, input: {
  id?: number; name: string; adapter: string; config?: Record<string, unknown>; enabled?: boolean;
}): Promise<number> {
  const selected = adapter(app, input.adapter);
  if (!selected) throw new ApiError(400, "Home adapter is not linked");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 191)
    throw new ApiError(400, "Invalid provider name");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new ApiError(400, "Invalid enabled flag");
  const previous = input.id === undefined ? undefined : await provider(app, input.id);
  if (previous && previous.adapter !== input.adapter && await used(app, previous.id))
    throw new ApiError(409, "Provider has datapoints; create another instance to change its adapter");
  const schema = selected.schema ?? { type: "object", properties: {} };
  const old = previous?.adapter === input.adapter ? previous.config : {};
  const config = merge(input.config ?? {}, old, schema) as Record<string, unknown>;
  if (validate(schema, config).length) throw new ApiError(400, "Invalid home provider configuration");
  const values = {
    name: input.name, adapter: input.adapter, config: JSON.stringify(config),
    enabled: input.enabled ?? previous?.enabled ?? true,
  };
  const id = await app.db.unit(async () => {
    if (previous) { await app.db.table("home_provider").update(previous.id, values); return previous.id; }
    return Number(await app.db.table("home_provider").insert(values));
  });
  await app.fire("home:provider", { id, adapter: input.adapter, previousAdapter: previous?.adapter });
  return id;
}

const used = (app: App, id: number) => app.db.one`SELECT id FROM home_datapoint WHERE provider = ${id} LIMIT 1`;

export async function enable(app: App, id: number, enabled: boolean): Promise<void> {
  const previous = await provider(app, id);
  await app.db.query`UPDATE home_provider SET enabled = ${enabled} WHERE id = ${id}`;
  await app.fire("home:provider", { id, adapter: previous.adapter, previousAdapter: previous.adapter });
}

/** Retiring a provider leaves its measurement identities and archive intact. */
export async function remove(app: App, id: number): Promise<void> {
  const previous = await provider(app, id);
  if (await used(app, id)) throw new ApiError(409, "Provider has datapoints; disable it instead");
  await app.db.query`DELETE FROM home_provider WHERE id = ${id}`;
  await app.fire("home:provider", { id, adapter: previous.adapter, previousAdapter: previous.adapter });
}

/** The adapter serving an enabled provider. */
export async function active(app: App, id: number): Promise<Adapter> {
  const row = await provider(app, id);
  if (!row.enabled) throw new ApiError(503, "Home provider is disabled");
  return adapter(app, row.adapter) ?? Promise.reject(new ApiError(503, "Home adapter is not linked"));
}

/** Without an ID, enabled providers that fail (offline, unlinked) are left out; query one to see its error. */
export async function entities(app: App, id?: number): Promise<(Entity & { provider: number })[]> {
  const ids = id === undefined ? (await providers(app)).filter((row) => row.enabled).map((row) => row.id) : [id];
  const results = await Promise.allSettled(ids.map(async (id) => {
    return (await (await active(app, id)).entities(app, id)).map((entity) => ({ ...entity, provider: id }));
  }));
  if (id !== undefined && results[0].status === "rejected") throw results[0].reason;
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export async function actions(app: App, id: number) {
  return (await (await active(app, id)).actions(app, id)).map((action) => ({ ...action, provider: id }));
}

/** Dispatch once. A failed or interrupted action is never automatically replayed. */
export async function call(app: App, id: number, action: string, input: Call = {}): Promise<unknown> {
  return (await active(app, id)).call(app, id, action, input);
}

/** Publish an observation without triggering change rules, e.g. an initial provider snapshot. */
export async function observed(
  app: App, provider: number, id: string, entity: Entity | null,
  time = entity?.updated === undefined ? Date.now() : Date.parse(entity.updated),
): Promise<void> {
  await app.fire("home:observe", { provider, id, entity, time });
}

/** Publish an observation, including creation (`previous: null`) or removal (`entity: null`). */
export async function changed(
  app: App, provider: number, id: string, entity: Entity | null, previous: Entity | null,
): Promise<void> {
  await observed(app, provider, id, entity);
  await app.fire("home:change", { provider, id, entity, previous });
}
