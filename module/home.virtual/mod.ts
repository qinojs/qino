import { ApiError, NotFoundError } from "@qino/qino";
import { command, entities as observe, provider, run, saveCommand } from "@qino/qino/home";

import { validate } from "@qino/item/tools/schema/validator.js";
import android from "./templates/android.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Action, Adapter, Entity } from "@qino/qino/home";

/**
 * A virtual entity of a `virtual` provider: its state is read from a source entity of any provider,
 * it is set through a stored command. `value` is the JSON schema of the value it is set to.
 */
export type Virtual = {
  id: number; provider: number; name: string; source_provider: number; source_entity: string;
  command: number; value: Record<string, unknown>;
};

const decode = (row: Virtual): Virtual => ({
  ...row, id: Number(row.id), provider: Number(row.provider), source_provider: Number(row.source_provider),
  command: Number(row.command), value: typeof row.value === "string" ? JSON.parse(row.value) : row.value,
});

// Sources by `provider:entity`, per App: source changes arrive for every entity of every provider.
const SOURCES = Symbol("home.virtual");
type Owned = App & { [SOURCES]?: Promise<Map<string, Virtual[]>> };
const forget = (app: App) => { delete (app as Owned)[SOURCES]; };

export async function sourced(app: App, provider: number, entity: string): Promise<Virtual[]> {
  (app as Owned)[SOURCES] ??= virtuals(app).then((rows) => Map.groupBy(
    rows.filter((row) => row.source_provider), (row) => `${row.source_provider}:${row.source_entity}`,
  ));
  return (await (app as Owned)[SOURCES]!).get(`${provider}:${entity}`) ?? [];
}

export async function virtuals(app: App, provider?: number): Promise<Virtual[]> {
  const rows = provider === undefined
    ? await app.db.query<Virtual>`SELECT * FROM home_virtual ORDER BY name, id`
    : await app.db.query<Virtual>`SELECT * FROM home_virtual WHERE provider = ${provider} ORDER BY name, id`;
  return rows.map(decode);
}

export async function virtual(app: App, id: number): Promise<Virtual> {
  const row = await app.db.row<Virtual>`SELECT * FROM home_virtual WHERE id = ${id}`;
  if (!row) throw new NotFoundError("Virtual entity was not found");
  return decode(row);
}

/** Create a virtual entity, or edit one by ID. Sources are real entities: virtual ones could form cycles. */
export async function saveVirtual(app: App, input: Partial<Virtual>): Promise<number> {
  const previous = input.id === undefined ? undefined : await virtual(app, input.id);
  const row = { source_provider: 0, source_entity: "", command: 0, value: {}, ...previous, ...input };
  const { provider: id, name, source_provider, source_entity, command: linked, value } = row;
  if (!Number.isSafeInteger(id) || typeof name !== "string" || !name.trim() || name.length > 191
    || !Number.isSafeInteger(source_provider) || typeof source_entity !== "string" || source_entity.length > 191
    || !source_provider !== !source_entity || !Number.isSafeInteger(linked) || !value || typeof value !== "object")
    throw new ApiError(400, "Invalid virtual entity provider, name, source, command or value schema");
  if ((await provider(app, id!)).adapter !== "virtual") throw new ApiError(400, "Select a virtual provider");
  if (source_provider && (await provider(app, source_provider)).adapter === "virtual")
    throw new ApiError(400, "A source must be an entity of another provider");
  if (linked) await command(app, linked);
  const values = { provider: id, name, source_provider, source_entity, command: linked, value: JSON.stringify(value) };
  const saved = previous
    ? (await app.db.table("home_virtual").update(previous.id, values), previous.id)
    : Number(await app.db.table("home_virtual").insert(values));
  forget(app);
  return saved;
}

export async function removeVirtual(app: App, id: number): Promise<void> {
  await virtual(app, id);
  await app.db.exec`DELETE FROM home_virtual WHERE id = ${id}`;
  forget(app);
}

/** The source's observation as the virtual entity's. */
export const view = (row: Virtual, entity: Entity | null): Entity | null =>
  entity && { ...entity, id: String(row.id), name: row.name };

export const homeProvider: Adapter = {
  name: "virtual",
  schema: { type: "object", title: "Virtual", additionalProperties: false, properties: {} },
  async entities(app, id) {
    const rows = await virtuals(app, id);
    const sources = [...new Set(rows.map((row) => row.source_provider).filter(Boolean))];
    const found = new Map(await Promise.all(sources.map(async (source) =>
      [source, await observe(app, source).catch(() => [])] as const)));
    return rows.map((row) => {
      const source = found.get(row.source_provider)?.find((entity) => entity.id === row.source_entity);
      // Without a source the entity is only set; a missing or offline source makes it unavailable.
      return view(row, source ?? { id: "", name: "", state: null, attributes: {}, available: !row.source_provider })!;
    });
  },
  async actions(app, id) {
    const rows = (await virtuals(app, id)).filter((row) => row.command);
    return await Promise.all(rows.map(async (row): Promise<Action> => {
      const { parameter } = await command(app, row.command).catch(() => ({ parameter: "" }));
      return {
        id: `set.${row.id}`, name: row.name, targets: [String(row.id)],
        input: parameter
          ? { type: "object", properties: { value: row.value }, required: ["value"] }
          : { type: "object", properties: {} },
      };
    }));
  },
  async call(app, id, action, { data = {} }) {
    const row = /^set\.\d+$/.test(action) ? await virtual(app, Number(action.slice(4))) : undefined;
    if (!row || row.provider !== id || !row.command) throw new ApiError(404, "Virtual action was not found");
    const { parameter } = await command(app, row.command);
    if (!parameter) return run(app, row.command);
    if (data.value === undefined || validate(row.value, data.value).length)
      throw new ApiError(400, "Invalid value for this virtual entity");
    return run(app, row.command, { value: data.value });
  },
};

type Entry = {
  name: string; source?: string; action: string; data?: Record<string, unknown>; parameter?: string;
  value?: Record<string, unknown>;
};
type Template = { title: string; adapter: string; description?: string; entities: Entry[] };

/** Shipped templates: pairs of source entity and command that a kind of device always has. */
export const templates: Record<string, Template> = { android: android as Template };

/**
 * Create a template's commands on `source` (a provider of the template's adapter) and its virtual entities
 * on `provider`. `{device}` in the template is replaced by `device`; existing names are skipped.
 */
export async function apply(
  app: App, name: string, { provider: id, source, device }: { provider: number; source: number; device: string },
): Promise<number[]> {
  const template = Object.hasOwn(templates, name) ? templates[name] : undefined;
  if (!template) throw new NotFoundError("Virtual template was not found");
  if (typeof device !== "string" || !/^[a-z0-9_]+$/.test(device)) throw new ApiError(400, "Invalid device name");
  if ((await provider(app, source)).adapter !== template.adapter)
    throw new ApiError(400, `The template needs a ${template.adapter} provider`);
  const fill = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll("{device}", device));
  const existing = new Set((await virtuals(app, id)).map((row) => row.name));
  const created: number[] = [];
  for (const entry of fill(template.entities)) {
    const label = `${device} ${entry.name}`;
    if (existing.has(label)) continue;
    const linked = await saveCommand(app, {
      provider: source, name: label, action: entry.action, data: entry.data ?? {}, parameter: entry.parameter ?? "",
    });
    created.push(await saveVirtual(app, {
      provider: id, name: label, source_provider: entry.source ? source : 0, source_entity: entry.source ?? "",
      command: linked, value: entry.value ?? {},
    }));
  }
  return created;
}
