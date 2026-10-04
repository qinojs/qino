import { Access, NotFoundError, s } from "@qino/qino";

import { actions, adapters, call, configure, datapoint, datapoints, enable, entities, provider, providers, remove, save } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { Call, Provider } from "./mod.ts";

const query = s.object({ provider: s.optional(s.number()).describe("Numeric provider instance ID; omit to include enabled instances") });
const config = s.object({ name: s.string(), adapter: s.string(), url: s.string(), config: s.optional(s.record(s.any())), enabled: s.optional(s.boolean()) });

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

function publicProvider(app: Ctx["app"], row: Provider) {
  const schema = adapters(app).find((adapter) => adapter.name === row.adapter)?.schema;
  return { ...row, config: schema ? readable(row.config, schema) : {} };
}

const pointConfig = s.object({
  provider: s.number(), entity: s.string(), name: s.optional(s.string()), unit: s.optional(s.string()),
  type: s.optional(s.string()), mapping: s.optional(s.record(s.number())), interval: s.optional(s.number()), record: s.optional(s.boolean()),
});

export const api: ApiTree = {
  datapoints: {
    get: { access: Access.USER, description: "List persisted home datapoints", query, execute: ({ provider }: Params, ctx: Ctx) => datapoints(ctx.app, provider as number | undefined) },
    post: { access: Access.USER, description: "Configure a typed home datapoint", input: pointConfig, execute: async (input: Params, ctx: Ctx) => ({ id: await configure(ctx.app, input as Parameters<typeof configure>[1]) }) },
  },
  datapoint: { ":datapoint": {
    paramSchema: s.number(),
    get: { access: Access.USER, description: "Read one persisted home datapoint", execute: ({ datapoint: id }: Params, ctx: Ctx) => datapoint(ctx.app, Number(id)) },
    put: { access: Access.USER, description: "Edit datapoint recording policy and display metadata; value interpretation is immutable", input: pointConfig, execute: async ({ datapoint: id, ...input }: Params, ctx: Ctx) => ({ id: await configure(ctx.app, { ...input, id: Number(id) } as Parameters<typeof configure>[1]) }) },
  } },
  adapters: { get: {
    description: "List linked home adapter implementations and their instance configuration schemas",
    access: Access.USER,
    execute: (_: Params, ctx: Ctx) => adapters(ctx.app).map(({ name, schema }) => ({ name, schema })),
  } },
  providers: {
    get: {
      description: "List persisted home provider instances; credentials are redacted",
      access: Access.USER,
      execute: async (_: Params, ctx: Ctx) => (await providers(ctx.app)).map((row) => publicProvider(ctx.app, row)),
    },
    post: {
      description: "Create one home provider instance with its own endpoint and configuration",
      access: Access.USER, input: config,
      execute: async (input: Params, ctx: Ctx) => ({ id: await save(ctx.app, input as Parameters<typeof save>[1]) }),
    },
  },
  entities: { get: {
    description: "List observed home entities; entity IDs are local to a numeric provider instance",
    access: Access.USER, query,
    execute: ({ provider }: Params, ctx: Ctx) => entities(ctx.app, provider as number | undefined),
  } },
  actions: { get: {
    description: "Discover home actions for one provider instance",
    access: Access.USER, query: s.object({ provider: s.number() }),
    execute: ({ provider }: Params, ctx: Ctx) => actions(ctx.app, Number(provider)),
  } },
  provider: { ":provider": {
    paramSchema: s.number(),
    get: {
      description: "Read one provider instance without credentials",
      access: Access.USER,
      execute: async ({ provider: id }: Params, ctx: Ctx) => publicProvider(ctx.app, await provider(ctx.app, Number(id))),
    },
    put: {
      description: "Edit one provider instance; blank secret fields keep stored credentials",
      access: Access.USER, input: config,
      execute: async ({ provider: id, ...input }: Params, ctx: Ctx) => ({ id: await save(ctx.app, { ...input, id: Number(id) } as Parameters<typeof save>[1]) }),
    },
    patch: {
      description: "Enable or disable one provider while retaining its configuration and datapoints",
      access: Access.USER, input: s.object({ enabled: s.boolean() }),
      execute: async ({ provider: id, enabled }: Params, ctx: Ctx) => { await enable(ctx.app, Number(id), Boolean(enabled)); return { ok: true }; },
    },
    delete: {
      description: "Retire a provider instance; existing measurement archives remain intact",
      access: Access.USER,
      execute: async ({ provider: id }: Params, ctx: Ctx) => { await remove(ctx.app, Number(id)); return { ok: true }; },
    },
    entity: { ":entity": {
      paramSchema: s.string(),
      get: {
        description: "Read one observed home entity; this does not change the device",
        access: Access.USER,
        execute: async ({ provider, entity }: Params, ctx: Ctx) => {
          const found = (await entities(ctx.app, Number(provider))).find((value) => value.id === entity);
          if (!found) throw new NotFoundError("Home entity was not found");
          return found;
        },
      },
    } },
    action: { ":action": {
      paramSchema: s.string(),
      post: {
        description: "Execute one discovered home action. Acknowledgement is not a device state; observe home:change for that.",
        access: Access.USER,
        input: s.object({
          entities: s.optional(s.array(s.string())).describe("Provider-local target entity IDs"),
          data: s.optional(s.record(s.any())).describe("Provider-defined action fields"),
        }),
        execute: ({ provider, action, entities, data }: Params, ctx: Ctx) => call(ctx.app, Number(provider), String(action), { entities, data } as Call),
      },
    } },
  } },
};
