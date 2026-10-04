import { Access, s } from "@qino/qino";

import { history, providers } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

export const api: ApiTree = {
  providers: { get: {
    access: Access.USER,
    description: "List linked home providers that support stored observations",
    execute: (_: Params, ctx: Ctx) => providers(ctx.app),
  } },
  provider: { ":provider": {
    paramSchema: s.string(),
    entity: { ":entity": {
      paramSchema: s.string(),
      get: {
        access: Access.USER,
        description: "Read stored observations for one entity and explicit period; missing data is not interpolated",
        query: s.object({
          start: s.string().describe("ISO timestamp with timezone, before end"),
          end: s.string().describe("ISO timestamp with timezone, after start"),
        }),
        execute: ({ provider, entity, start, end }: Params, ctx: Ctx) =>
          history(ctx.app, String(provider), String(entity), { start: String(start), end: String(end) }),
      },
    } },
  } },
};
