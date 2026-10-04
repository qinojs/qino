import { Access, NotFoundError, s } from "@qino/qino";

import { actions, call, entities, providers } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { Call } from "./mod.ts";

const query = s.object({ provider: s.optional(s.string()).describe("Omit to include every linked provider") });

export const api: ApiTree = {
  providers: { get: {
    description: "List linked home automation providers",
    access: Access.USER,
    execute: (_: Params, ctx: Ctx) => providers(ctx.app),
  } },
  entities: { get: {
    description: "List observed home entities and their states; IDs are local to their provider",
    access: Access.USER,
    query,
    execute: ({ provider }: Params, ctx: Ctx) => entities(ctx.app, provider as string | undefined),
  } },
  actions: { get: {
    description: "Discover home actions and their provider-defined input fields",
    access: Access.USER,
    query,
    execute: ({ provider }: Params, ctx: Ctx) => actions(ctx.app, provider as string | undefined),
  } },
  provider: { ":provider": {
    paramSchema: s.string(),
    entity: { ":entity": {
      paramSchema: s.string(),
      get: {
        description: "Read one observed home entity; this does not change the device",
        access: Access.USER,
        execute: async ({ provider, entity }: Params, ctx: Ctx) => {
          const found = (await entities(ctx.app, String(provider))).find((e) => e.id === entity);
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
          entities: s.optional(s.array(s.string())).describe("Provider-local target entity IDs; omit for an action without explicit entities"),
          data: s.optional(s.record(s.any())).describe("Input fields from home_actions_get; names and values are defined by the provider"),
        }),
        execute: ({ provider, action, entities, data }: Params, ctx: Ctx) =>
          call(ctx.app, String(provider), String(action), { entities, data } as Call),
      },
    } },
  } },
};
