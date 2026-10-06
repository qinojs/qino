import { Access, NotFoundError, s } from "@qino/qino";

import {
  actions, adapters, call, command, commands, configure, datapoint, datapoints, enable, entities, provider, providers,
  redact, remove, removeCommand, run, save, saveCommand,
} from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { Call, Command } from "./mod.ts";

// Providers reach into the house: configuration, live states and device actions are superuser-only.
const access = Access.SUPERUSER;
const query = s.object({
  provider: s.optional(s.number()).describe("Numeric provider instance ID; omit to include enabled instances"),
});
const config = s.object({
  name: s.string(), adapter: s.string(), config: s.optional(s.record(s.any())), enabled: s.optional(s.boolean()),
});
const meta = { name: s.optional(s.string()), interval: s.optional(s.number()), record: s.optional(s.boolean()) };
const source = s.object({
  provider: s.number(), entity: s.string(), unit: s.optional(s.string()), type: s.optional(s.string()),
  mapping: s.optional(s.record(s.number())), ...meta,
});
const order = {
  name: s.string(), action: s.string().describe("Discovered action ID"),
  targets: s.optional(s.array(s.string())).describe("Provider-local target entity IDs"),
  data: s.optional(s.record(s.any())).describe("Provider-defined action data"),
  parameter: s.optional(s.string()).describe("Dotted path in data that a run-time value fills, e.g. data.command"),
};

export const api: ApiTree = {
  datapoints: {
    get: {
      access, description: "List persisted home datapoints", query,
      execute: ({ provider }: Params, ctx: Ctx) => datapoints(ctx.app, provider as number | undefined),
    },
    post: {
      access, description: "Configure a typed home datapoint; an existing one with the same interpretation is reused",
      input: source,
      execute: async (input: Params, ctx: Ctx) => ({ id: await configure(ctx.app, input as Parameters<typeof configure>[1]) }),
    },
  },
  datapoint: { ":datapoint": {
    paramSchema: s.number(),
    get: {
      access, description: "Read one persisted home datapoint",
      execute: ({ datapoint: id }: Params, ctx: Ctx) => datapoint(ctx.app, Number(id)),
    },
    put: {
      access, description: "Edit datapoint name, expected interval and recording; value interpretation is immutable",
      input: s.object(meta),
      execute: async ({ datapoint: id, ...input }: Params, ctx: Ctx) => ({ id: await configure(ctx.app, { ...input, id: Number(id) }) }),
    },
  } },
  commands: {
    get: {
      access, description: "List stored home commands: named action calls", query,
      execute: ({ provider }: Params, ctx: Ctx) => commands(ctx.app, provider as number | undefined),
    },
    post: {
      access, description: "Store a named action call of one provider",
      input: s.object({ provider: s.number(), ...order }),
      execute: async (input: Params, ctx: Ctx) => ({ id: await saveCommand(ctx.app, input as Partial<Command>) }),
    },
  },
  command: { ":command": {
    paramSchema: s.number(),
    get: {
      access, description: "Read one stored home command",
      execute: ({ command: id }: Params, ctx: Ctx) => command(ctx.app, Number(id)),
    },
    put: {
      access, description: "Edit one stored home command",
      input: s.object({
        name: s.optional(order.name), action: s.optional(order.action), targets: order.targets, data: order.data,
        parameter: order.parameter,
      }),
      execute: async ({ command: id, ...input }: Params, ctx: Ctx) =>
        ({ id: await saveCommand(ctx.app, { ...input, id: Number(id) } as Partial<Command>) }),
    },
    delete: {
      access, description: "Delete one stored home command",
      execute: async ({ command: id }: Params, ctx: Ctx) => { await removeCommand(ctx.app, Number(id)); return { ok: true }; },
    },
    run: { post: {
      access,
      description: "Execute a stored command once. Acknowledgement is not a device state; observe home:change for that.",
      input: s.object({
        data: s.optional(s.record(s.any())).describe("Values added to or overriding the stored data"),
        value: s.optional(s.any()).describe("Fills the command's parameter, in the device's own units"),
      }),
      execute: ({ command: id, data, value }: Params, ctx: Ctx) =>
        run(ctx.app, Number(id), { data: data as Record<string, unknown> | undefined, value }),
    } },
  } },
  adapters: { get: {
    access, description: "List linked home adapter implementations and their instance configuration schemas",
    execute: (_: Params, ctx: Ctx) => adapters(ctx.app).map(({ name, schema }) => ({ name, schema })),
  } },
  providers: {
    get: {
      access, description: "List persisted home provider instances; credentials are redacted",
      execute: async (_: Params, ctx: Ctx) => (await providers(ctx.app)).map((row) => redact(ctx.app, row)),
    },
    post: {
      access, description: "Create one home provider instance with its own endpoint and configuration", input: config,
      execute: async (input: Params, ctx: Ctx) => ({ id: await save(ctx.app, input as Parameters<typeof save>[1]) }),
    },
  },
  entities: { get: {
    access, description: "List observed home entities; entity IDs are local to a numeric provider instance", query,
    execute: ({ provider }: Params, ctx: Ctx) => entities(ctx.app, provider as number | undefined),
  } },
  actions: { get: {
    access, description: "Discover home actions for one provider instance", query: s.object({ provider: s.number() }),
    execute: ({ provider }: Params, ctx: Ctx) => actions(ctx.app, Number(provider)),
  } },
  provider: { ":provider": {
    paramSchema: s.number(),
    get: {
      access, description: "Read one provider instance without credentials",
      execute: async ({ provider: id }: Params, ctx: Ctx) => redact(ctx.app, await provider(ctx.app, Number(id))),
    },
    put: {
      access, description: "Edit one provider instance; blank secret fields keep stored credentials", input: config,
      execute: async ({ provider: id, ...input }: Params, ctx: Ctx) =>
        ({ id: await save(ctx.app, { ...input, id: Number(id) } as Parameters<typeof save>[1]) }),
    },
    patch: {
      access, description: "Enable or disable one provider while retaining its configuration and datapoints",
      input: s.object({ enabled: s.boolean() }),
      execute: async ({ provider: id, enabled }: Params, ctx: Ctx) => {
        await enable(ctx.app, Number(id), Boolean(enabled));
        return { ok: true };
      },
    },
    delete: {
      access, description: "Retire a provider instance; existing measurement archives remain intact",
      execute: async ({ provider: id }: Params, ctx: Ctx) => { await remove(ctx.app, Number(id)); return { ok: true }; },
    },
    entity: { ":entity": {
      paramSchema: s.string(),
      get: {
        access, description: "Read one observed home entity; this does not change the device",
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
        access,
        description: "Execute one discovered home action. Acknowledgement is not a device state; observe home:change for that.",
        input: s.object({
          entities: s.optional(s.array(s.string())).describe("Provider-local target entity IDs"),
          data: s.optional(s.record(s.any())).describe("Provider-defined action fields"),
        }),
        execute: ({ provider, action, entities, data }: Params, ctx: Ctx) =>
          call(ctx.app, Number(provider), String(action), { entities, data } as Call),
      },
    } },
  } },
};
