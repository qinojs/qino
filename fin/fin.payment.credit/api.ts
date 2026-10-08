import { Access, s } from "@qino/qino";
import { ownerOf } from "@qino/qino/fin";

import { add, moves } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** A user reads their own credit; adding to it, or taking from it, is a superuser's. */
export const api: ApiTree = {
  get: {
    description: "A user's credit: the balance per currency, and what moved, newest first",
    access: Access.USER,
    query: s.object({ usrId: s.optional(s.number().describe("Whose (superuser); the user's own by default")) }),
    execute: async ({ usrId }: Params, ctx: Ctx) => {
      const whose = ownerOf(ctx) ?? Number(usrId ?? ctx.userId);
      const balances = await ctx.app.db.query`SELECT currency, SUM(amount) AS amount FROM payment_credit
        WHERE usr_id = ${whose} GROUP BY currency HAVING SUM(amount) <> 0 ORDER BY currency`;
      return { balances, moves: await moves(ctx.app, whose) };
    },
  },
  post: {
    description: "Add to a user's credit, or take from it with a negative amount; never below zero",
    access: Access.SUPERUSER,
    input: s.object({
      usrId: s.number(),
      amount: s.number().describe("Minor units"),
      currency: s.string().describe("ISO 4217"),
      text: s.optional(s.string().describe("Why, as the user reads it")),
      ref: s.optional(s.string()),
    }),
    execute: ({ usrId, ...values }: Params, ctx: Ctx) =>
      add(ctx.app, Number(usrId), values as Parameters<typeof add>[2]),
  },
};
