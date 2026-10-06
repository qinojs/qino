import { ApiError, NotFoundError } from "@qino/qino";

import { call, provider } from "./mod.ts";

import type { App } from "@qino/qino";

/**
 * A named, stored action call: what a datapoint is to observations, a command is to actions.
 * `parameter` is the dotted path in `data` that a run-time value fills, e.g. `data.command`; empty for none.
 */
export type Command = {
  id: number; provider: number; name: string; action: string; targets: string[]; data: Record<string, unknown>;
  parameter: string;
};

const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
const decode = (row: Command): Command => ({
  ...row, id: Number(row.id), provider: Number(row.provider), targets: json(row.targets), data: json(row.data),
  parameter: row.parameter ?? "",
});
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const path = (value: unknown) => typeof value === "string" && value.length <= 191 && (value === ""
  || value.split(".").every((key) => key && !["__proto__", "constructor", "prototype"].includes(key)));

/** A copy of `data` with `value` at the dotted `path`, creating objects on the way. */
function place(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const result = structuredClone(data), keys = path.split(".");
  let node = result;
  for (const key of keys.slice(0, -1)) node = node[key] = object(node[key]) ? node[key] : {};
  node[keys.at(-1)!] = value;
  return result;
}

export async function commands(app: App, provider?: number): Promise<Command[]> {
  const rows = provider === undefined
    ? await app.db.query<Command>`SELECT * FROM home_command ORDER BY name, id`
    : await app.db.query<Command>`SELECT * FROM home_command WHERE provider = ${provider} ORDER BY name, id`;
  return rows.map(decode);
}

export async function command(app: App, id: number): Promise<Command> {
  const row = await app.db.row<Command>`SELECT * FROM home_command WHERE id = ${id}`;
  if (!row) throw new NotFoundError("Home command was not found");
  return decode(row);
}

/** Create a command, or edit one by ID. Action IDs are not checked: a provider may be offline. */
export async function saveCommand(app: App, input: Partial<Command>): Promise<number> {
  const previous = input.id === undefined ? undefined : await command(app, input.id);
  const { provider: id, name, action, targets = [], data = {}, parameter = "" } = { ...previous, ...input };
  if (!Number.isSafeInteger(id) || typeof name !== "string" || !name.trim() || name.length > 191
    || typeof action !== "string" || !action || action.length > 191 || !path(parameter)
    || !Array.isArray(targets) || !targets.every((target) => typeof target === "string") || !object(data))
    throw new ApiError(400, "Invalid command provider, name, action, targets, data or parameter");
  await provider(app, id!);
  const values = {
    provider: id, name, action, targets: JSON.stringify(targets), data: JSON.stringify(data), parameter,
  };
  if (previous) { await app.db.table("home_command").update(previous.id, values); return previous.id; }
  return Number(await app.db.table("home_command").insert(values));
}

export async function removeCommand(app: App, id: number): Promise<void> {
  await command(app, id);
  await app.db.query`DELETE FROM home_command WHERE id = ${id}`;
}

/**
 * Call a command once. `data` adds to or overrides the stored data; `value` fills the command's parameter,
 * e.g. a setpoint chosen at run time. Values keep the device's own units.
 */
export async function run(
  app: App, id: number, { data = {}, value }: { data?: Record<string, unknown>; value?: unknown } = {},
): Promise<unknown> {
  if (!object(data)) throw new ApiError(400, "Command data must be an object");
  const { provider, action, targets, data: stored, parameter } = await command(app, id);
  if (value !== undefined && !parameter) throw new ApiError(400, "This command takes no value");
  const merged = { ...stored, ...data };
  const input = value === undefined ? merged : place(merged, parameter, value);
  return call(app, provider, action, { ...targets.length ? { entities: targets } : {}, data: input });
}
