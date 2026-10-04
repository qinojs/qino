import { Access, App, s } from "@qino/qino";

import { history, providers } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

export const api: ApiTree = {
  providers: { get: {
    access: Access.USER,
    description: "List live and local archive providers that support stored observations",
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
          source: s.optional(s.string()).describe("auto prefers a configured local series; local or provider selects explicitly"),
          limit: s.optional(s.number()).describe("Maximum observations; default 100000, excess reports an error"),
        }),
        execute: ({ provider, entity, start, end, source, limit }: Params, ctx: Ctx) =>
          history(ctx.app, String(provider), String(entity), { start: String(start), end: String(end), source: source as "auto" | "local" | "provider" | undefined, limit: limit as number | undefined }),
      },
    } },
  } },
};

Object.assign(App.events, {
  "home.history:providers": {
    description: "Local archives may add provider names, including disconnected providers.",
    data: s.object({ providers: s.array(s.string()) }),
  },
  "home.history:read": {
    description: "A local home archive may supply data before a live provider is consulted; an empty array is an answered query.",
    data: s.object({ provider: s.string(), id: s.string(), start: s.number(), end: s.number(), source: s.string(), limit: s.number(), data: s.optional(s.any()) }),
  },
});
