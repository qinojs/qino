import { Access, s } from "@qino/qino";

import { history } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { Period } from "./mod.ts";

export const api: ApiTree = { datapoint: { ":datapoint": {
  paramSchema: s.number(),
  get: {
    access: Access.SUPERUSER,
    description: "Read typed measurements for one numeric datapoint ID and an explicit period",
    query: s.object({
      start: s.string(), end: s.string(), source: s.optional(s.string()), limit: s.optional(s.number()),
      width: s.optional(s.number()), consumption: s.optional(s.boolean()), maxGap: s.optional(s.number()),
    }),
    execute: ({ datapoint, ...period }: Params, ctx: Ctx) => history(ctx.app, Number(datapoint), period as Period),
  },
} } };
