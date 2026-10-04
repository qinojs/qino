import { Access, s } from "@qino/qino";

import { configure, series } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

export const api: ApiTree = {
  series: { get: {
    access: Access.USER,
    description: "List configured local home measurement series, including stopped recordings",
    execute: (_: Params, ctx: Ctx) => series(ctx.app),
  } },
  provider: { ":provider": { paramSchema: s.string(), entity: { ":entity": {
    paramSchema: s.string(),
    post: {
      access: Access.USER,
      description: "Enable or stop local capture of one home entity; existing observations are kept",
      input: s.object({ enabled: s.boolean() }),
      execute: async ({ provider, entity, enabled }: Params, ctx: Ctx) => {
        await configure(ctx.app, String(provider), String(entity), Boolean(enabled));
        return { enabled };
      },
    },
  } } } },
};
