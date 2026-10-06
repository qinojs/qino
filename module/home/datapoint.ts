import { ApiError, NotFoundError, sha256hex } from "@qino/qino";

import { provider } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Entity } from "./mod.ts";

/**
 * One value of an entity: its state (empty `path`) or a leaf of its attributes, e.g. `brightness` or
 * `ENERGY/Power`. Source and interpretation are fixed; name, interval and recording can change.
 */
export type Datapoint = {
  id: number; provider: number; entity: string; path: string; identity: string; name: string; unit: string;
  type: "number" | "state"; mapping: Record<string, number>; interval: number; record: boolean;
  value: number | null; time: number | null;
};

const decode = (row: Datapoint): Datapoint => ({
  ...row, path: row.path ?? "", id: Number(row.id), provider: Number(row.provider), record: Boolean(row.record),
  mapping: typeof row.mapping === "string" ? JSON.parse(row.mapping) : row.mapping,
  time: row.time === null ? null : Number(row.time), value: row.value === null ? null : Number(row.value),
});

export async function datapoints(app: App, provider?: number): Promise<Datapoint[]> {
  const rows = provider === undefined
    ? await app.db.query<Datapoint>`SELECT * FROM home_datapoint ORDER BY id`
    : await app.db.query<Datapoint>`SELECT * FROM home_datapoint WHERE provider = ${provider} ORDER BY id`;
  return rows.map(decode);
}

export async function datapoint(app: App, id: number): Promise<Datapoint> {
  const row = await app.db.row<Datapoint>`SELECT * FROM home_datapoint WHERE id = ${id}`;
  if (!row) throw new NotFoundError("Home datapoint was not found");
  return decode(row);
}

type Meta = { name?: string; interval?: number; record?: boolean };
type Source = {
  provider: number; entity: string; path?: string; unit?: string; type?: "number" | "state";
  mapping?: Record<string, number>;
};

/** Edit a datapoint by ID, or find/create one by its source; source and interpretation stay immutable. */
export async function configure(app: App, input: ({ id: number } | Source & { id?: undefined }) & Meta): Promise<number> {
  const id = await app.db.unit(async () => {
    const point = input.id === undefined ? await source(app, input) : await datapoint(app, input.id);
    const { name = point.name, interval = point.interval, record = point.record } = input;
    if (typeof name !== "string" || !name || name.length > 191 || typeof record !== "boolean"
      || !Number.isInteger(interval) || interval < 0 || interval > 2147483647)
      throw new ApiError(400, "Invalid datapoint name, interval or recording flag");
    const table = app.db.table("home_datapoint");
    if (point.id) { await table.update(point.id, { name, interval, record }); return point.id; }
    return Number(await table.insert({ ...point, mapping: JSON.stringify(point.mapping), name, interval, record }));
  });
  await app.fire("home:datapoint", { id });
  return id;
}

/** The datapoint with this interpretation, or a new unsaved one. */
async function source(app: App, input: Source): Promise<Omit<Datapoint, "id"> & { id?: number }> {
  const { entity, path = "", type = "number", unit = "", mapping: codes = {} } = input;
  if (!Number.isSafeInteger(input.provider) || typeof entity !== "string" || !entity || entity.length > 191
    || typeof path !== "string" || path.length > 191 || path.split("/").some((key) => path && !key)
    || typeof unit !== "string" || unit.length > 64 || !["number", "state"].includes(type) || typeof codes !== "object")
    throw new ApiError(400, "Invalid datapoint identity or type");
  await provider(app, input.provider);
  const mapping = Object.fromEntries(Object.entries(codes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  if (Object.values(mapping).some((code) => !Number.isInteger(code) || code < -128 || code > 127))
    throw new ApiError(400, "Invalid datapoint state mapping");
  if (type === "number" && Object.keys(mapping).length)
    throw new ApiError(400, "State mappings require a state datapoint");
  // A path joins the identity only when set: datapoints of the state keep theirs.
  const key = [input.provider, entity, type, unit, mapping, ...path ? [path] : []];
  const identity = await sha256hex(JSON.stringify(key));
  const row = await app.db.row<Datapoint>`SELECT * FROM home_datapoint WHERE identity = ${identity}`;
  if (row) return decode(row);
  return {
    provider: input.provider, entity, path, identity, name: path ? `${entity}/${path}` : entity, unit, type, mapping,
    interval: 0, record: false, value: null, time: null,
  };
}

/** An entity's values by path: `""` its state, then each attribute leaf; nested objects join with `/`. */
export function leaves(entity: Entity): [string, unknown][] {
  const walk = (value: unknown, path: string): [string, unknown][] =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, child]) => walk(child, path ? `${path}/${key}` : key))
      : [[path, value]];
  return [["", entity.state], ...walk(entity.attributes, "")];
}

/** The value at `path`: the state for `""`, otherwise an attribute leaf. */
export function at(entity: Entity, path: string): unknown {
  if (!path) return entity.state;
  let value: unknown = entity.attributes;
  for (const key of path.split("/")) {
    const node = value as Record<string, unknown>;
    value = node && typeof node === "object" && Object.hasOwn(node, key) ? node[key] : undefined;
  }
  return value;
}

/** Convert only values matching the declared datatype and unit. Missing observations stay null.
 *  An entity's unit describes its state; attribute values carry the unit their datapoint declares. */
export function value(point: Datapoint, entity: Entity | null): number | null {
  if (!entity?.available || !point.path && (entity.unit ?? "") !== point.unit) return null;
  const state = at(entity, point.path);
  if (point.type === "state" && typeof state === "string" && Object.hasOwn(point.mapping, state)) return point.mapping[state];
  if (point.type === "state" && typeof state === "boolean") return Number(state);
  if (!(typeof state === "number" || typeof state === "string" && state.trim())) return null;
  const numeric = Number(state);
  if (!Number.isFinite(numeric)) return null;
  if (point.type === "state" && (!Number.isInteger(numeric) || numeric < -128 || numeric > 127)) return null;
  return numeric;
}
