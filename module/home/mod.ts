import { ApiError, NotFoundError } from "@qino/qino";

import { validate } from "@qino/item/tools/schema/validator.js";

import type { App } from "@qino/qino";

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

export type Provider = { id: number; name: string; adapter: string; url: string; config: Record<string, unknown>; enabled: boolean };

/** Adapter names identify implementations; provider IDs identify configured connections. */
export function adapters(app: App): Adapter[] {
  const all = app.modules.linked().flatMap((mod) => mod.plugin.homeProvider ? [mod.plugin.homeProvider as Adapter] : []);
  if (new Set(all.map((adapter) => adapter.name)).size !== all.length) throw new Error("home: duplicate adapter names");
  return all;
}

const decode = (row: Provider): Provider => ({ ...row, id: Number(row.id), enabled: Boolean(row.enabled), config: typeof row.config === "string" ? JSON.parse(row.config) : row.config });

/** Trusted server access, including credentials. Public APIs redact write-only configuration. */
export async function providers(app: App): Promise<Provider[]> {
  return (await app.db.query<Provider>`SELECT * FROM home_provider ORDER BY id`).map(decode);
}

export async function provider(app: App, id: number): Promise<Provider> {
  const row = await app.db.row<Provider>`SELECT * FROM home_provider WHERE id = ${id}`;
  if (!row) throw new NotFoundError("Home provider was not found");
  return decode(row);
}

/** Create or edit an instance; empty secret fields preserve stored credentials. */
export async function save(app: App, input: { id?: number; name: string; adapter: string; url: string; config?: Record<string, unknown>; enabled?: boolean }): Promise<number> {
  const selected = adapters(app).find((adapter) => adapter.name === input.adapter);
  if (!selected) throw new ApiError(400, "Home adapter is not linked");
  if (!input.name.trim() || input.name.length > 191 || input.url.length > 2048) throw new ApiError(400, "Invalid provider name or URL");
  const previous = input.id === undefined ? undefined : await provider(app, input.id);
  const schema = selected.schema ?? { type: "object", properties: {} };
  const config = { ...(previous?.adapter === input.adapter ? previous.config : {}), ...input.config };
  for (const [key, field] of Object.entries((schema.properties ?? {}) as Record<string, { writeOnly?: boolean }>)) {
    if (field.writeOnly && config[key] === "") {
      if (previous?.adapter === input.adapter && previous.config[key] !== undefined) config[key] = previous.config[key];
      else delete config[key];
    }
  }
  if (validate(schema, { ...config, url: input.url }).length) throw new ApiError(400, "Invalid home provider configuration");
  const values = { name: input.name, adapter: input.adapter, url: input.url, config, enabled: input.enabled ?? true };
  const id = await app.db.unit(async () => {
    if (previous) { await app.db.table("home_provider").ensure({ id: previous.id, ...values }); return previous.id; }
    return Number(await app.db.table("home_provider").insert(values));
  });
  await app.fire("home:provider", { id, adapter: input.adapter, previousAdapter: previous?.adapter });
  return id;
}

/** Retiring a provider leaves its measurement identities and archive intact. */
export async function remove(app: App, id: number): Promise<void> {
  const previous = await provider(app, id);
  await app.db.query`DELETE FROM home_provider WHERE id = ${id}`;
  await app.fire("home:provider", { id, adapter: previous.adapter, previousAdapter: previous.adapter });
}

async function selected(app: App, id: number) {
  const row = await provider(app, id);
  if (!row.enabled) throw new ApiError(503, "Home provider is disabled");
  const adapter = adapters(app).find((adapter) => adapter.name === row.adapter);
  if (!adapter) throw new ApiError(503, "Home adapter is not linked");
  return { row, adapter };
}

export async function entities(app: App, id?: number) {
  const rows = id === undefined ? (await providers(app)).filter((row) => row.enabled) : [(await selected(app, id)).row];
  return (await Promise.all(rows.map(async (row) => {
    const { adapter } = await selected(app, row.id);
    return (await adapter.entities(app, row.id)).map((entity) => ({ ...entity, provider: row.id }));
  }))).flat();
}

export async function actions(app: App, id: number) {
  const { adapter } = await selected(app, id);
  return (await adapter.actions(app, id)).map((action) => ({ ...action, provider: id }));
}

/** Dispatch once. A failed or interrupted action is never automatically replayed. */
export async function call(app: App, id: number, action: string, input: Call = {}): Promise<unknown> {
  const { adapter } = await selected(app, id);
  return adapter.call(app, id, action, input);
}

/** Publish an observation, including creation (`previous: null`) or removal (`entity: null`). */
export async function changed(app: App, provider: number, id: string, entity: Entity | null, previous: Entity | null): Promise<void> {
  await app.fire("home:change", { provider, id, entity, previous });
}
