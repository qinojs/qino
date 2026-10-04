import { Access, App, s } from "@qino/qino";

import { history } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

export const api: ApiTree = { datapoint: { ":datapoint": {
  paramSchema: s.number(),
  get: {
    access: Access.USER,
    description: "Read typed measurements for one numeric datapoint ID and an explicit period",
    query: s.object({ start: s.string(), end: s.string(), source: s.optional(s.string()), limit: s.optional(s.number()), width: s.optional(s.number()), consumption: s.optional(s.boolean()), maxGap: s.optional(s.number()) }),
    execute: ({ datapoint, start, end, source, limit, width, consumption, maxGap }: Params, ctx: Ctx) => history(ctx.app, Number(datapoint), {
      start: String(start), end: String(end), source: source as "auto" | "local" | "provider" | undefined,
      limit: limit as number | undefined, width: width as number | undefined, consumption: consumption as boolean | undefined, maxGap: maxGap as number | undefined,
    }),
  },
} } };

Object.assign(App.events, { "home.history:read": {
  description: "A local measurement archive may answer before upstream history is consulted; an empty array is an answered query.",
  data: s.object({ datapoint: s.number(), start: s.number(), end: s.number(), source: s.string(), limit: s.number(), width: s.optional(s.number()), consumption: s.optional(s.boolean()), maxGap: s.optional(s.number()), data: s.optional(s.any()) }),
} });
