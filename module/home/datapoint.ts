import { ApiError, NotFoundError, sha256hex } from "@qino/qino";

import { provider } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Entity } from "./mod.ts";

export type Datapoint = {
  id: number; provider: number; entity: string; identity: string; name: string; unit: string;
  type: "number" | "state"; mapping: Record<string, number>; interval: number; record: boolean;
  value: number | null; time: number | null;
};

const decode = (row: Datapoint): Datapoint => ({
  ...row, id: Number(row.id), provider: Number(row.provider), record: Boolean(row.record),
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

/** A datapoint's identity and value interpretation stay immutable; create another for replacements. */
export async function configure(app: App, input: {
  id?: number; provider: number; entity: string; name?: string; unit?: string; type?: "number" | "state";
  mapping?: Record<string, number>; interval?: number; record?: boolean;
}): Promise<number> {
  await provider(app, input.provider);
  const previous = input.id === undefined ? undefined : await datapoint(app, input.id);
  const entity = input.entity, type = input.type ?? previous?.type ?? "number", unit = input.unit ?? previous?.unit ?? "";
  const mapping = Object.fromEntries(Object.entries(input.mapping ?? previous?.mapping ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const interval = input.interval ?? previous?.interval ?? 0, name = input.name ?? previous?.name ?? entity;
  if (!entity || entity.length > 191 || !name || name.length > 191 || unit.length > 64 || !["number", "state"].includes(type))
    throw new ApiError(400, "Invalid datapoint identity or type");
  if (!Number.isInteger(interval) || interval < 0 || interval > 2147483647 || Object.values(mapping).some((value) => !Number.isInteger(value) || value < -128 || value > 127))
    throw new ApiError(400, "Invalid datapoint interval or state mapping");
  if (type === "number" && Object.keys(mapping).length) throw new ApiError(400, "State mappings require a state datapoint");
  const identity = await sha256hex(JSON.stringify([input.provider, entity, type, unit, mapping]));
  if (previous && previous.identity !== identity) throw new ApiError(409, "Datapoint identity is immutable; create a new datapoint");
  const id = await app.db.unit(async () => {
    const existing = previous ?? await app.db.row<Datapoint>`SELECT * FROM home_datapoint WHERE identity = ${identity}`;
    const values = { provider: input.provider, entity, identity, unit, type, mapping: JSON.stringify(mapping), interval: input.interval ?? existing?.interval ?? interval, name: input.name ?? existing?.name ?? name, record: input.record ?? (existing ? decode(existing).record : false) };
    if (existing) { await app.db.table("home_datapoint").ensure({ id: existing.id, ...values }); return Number(existing.id); }
    return Number(await app.db.table("home_datapoint").insert({ ...values, value: null, time: null }));
  });
  await app.fire("home:datapoint", { id });
  return id;
}

/** Convert only values matching the declared datatype and unit. Missing observations stay null. */
export function value(point: Datapoint, entity: Entity | null): number | null {
  if (!entity?.available || (entity.unit ?? "") !== point.unit) return null;
  const state = entity.state;
  if (point.type === "state" && typeof state === "string" && Object.hasOwn(point.mapping, state)) return point.mapping[state];
  if (point.type === "state" && typeof state === "boolean") return Number(state);
  if (!(typeof state === "number" || typeof state === "string" && state.trim())) return null;
  const numeric = Number(state);
  if (!Number.isFinite(numeric) || point.type === "state" && (!Number.isInteger(numeric) || numeric < -128 || numeric > 127)) return null;
  return numeric;
}
