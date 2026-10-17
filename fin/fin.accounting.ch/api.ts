import { Access, s } from "@qino/qino";

import { vatReturn } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** The VAT return is a superuser's. */
export const api: ApiTree = {
  vat: {
    get: {
      description: "The Swiss VAT return of a period, from the books, in minor units",
      access: Access.SUPERUSER,
      query: s.object({ from: s.string().describe("YYYY-MM-DD"), to: s.string().describe("YYYY-MM-DD") }),
      execute: ({ from, to }: Params, ctx: Ctx) => vatReturn(ctx.app, { from: String(from), to: String(to) }),
    },
  },
};
