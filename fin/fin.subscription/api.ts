import { Access, s } from "@qino/qino";
import { ownerOf, visible } from "@qino/qino/fin";

import { bill, cancel, periods, plan, plans, subscribe, subscriptions, update } from "./mod.ts";

import type { ApiTree, Ctx, Params, Row } from "@qino/qino";

/** What a subscription is given; empty fields take the plan's. */
const VALUES = {
  planId: s.optional(s.number()),
  name: s.optional(s.string().describe("Without a plan what it is; with one the detail: example.ch")),
  description: s.optional(s.string()),
  price: s.optional(s.number().describe("Per period, in minor units")),
  currency: s.optional(s.string().describe("ISO 4217")),
  taxRate: s.optional(s.number().describe("Percent")),
  unit: s.optional(s.string().describe("month or year")),
  count: s.optional(s.number().describe("So many units make a period")),
  end: s.optional(s.string().describe("YYYY-MM-DD: no period begins on or after it")),
  ref: s.optional(s.string()),
};

/** A user reads their own subscriptions and ends them; anything else is a superuser's. */
export const api: ApiTree = {
  subscriptions: {
    get: {
      description: "Subscriptions with what applies to them and the next period (`next`): the user's own, "
        + "all for a superuser",
      access: Access.USER,
      query: s.object({ usrId: s.optional(s.number().describe("Only this user's (superuser)")) }),
      execute: ({ usrId }: Params, ctx: Ctx) => subscriptions(ctx.app, ownerOf(ctx) ?? (usrId as number | undefined)),
    },
    post: {
      description: "A new subscription: a plan, or what it is and costs; the id comes back",
      access: Access.SUPERUSER,
      input: s.object({
        ...VALUES,
        usrId: s.number(),
        start: s.string().describe("YYYY-MM-DD: the first period begins"),
      }),
      execute: (values: Params, ctx: Ctx) => subscribe(ctx.app, values as Parameters<typeof subscribe>[1]),
    },
  },
  plans: {
    get: {
      description: "The catalog: what is offered, at which price, per which period",
      access: Access.USER,
      execute: (_: Params, ctx: Ctx) => plans(ctx.app),
    },
    post: {
      description: "Add a plan, or change one (`id`): a new price applies from each subscription's next period",
      access: Access.SUPERUSER,
      input: s.object({
        id: s.optional(s.number()),
        name: s.string(),
        description: s.optional(s.string()),
        price: s.number().describe("Per period, in minor units"),
        currency: s.string().describe("ISO 4217"),
        taxRate: s.optional(s.number()),
        unit: s.optional(s.string().describe("month or year")),
        count: s.optional(s.number()),
      }),
      execute: (values: Params, ctx: Ctx) => plan(ctx.app, values as Parameters<typeof plan>[1]),
    },
  },
  bill: {
    post: {
      description: "Bill what renews within the lead time, as the daily job does; the invoices come back",
      access: Access.SUPERUSER,
      input: s.object({ until: s.optional(s.string().describe("YYYY-MM-DD; the lead time by default")) }),
      execute: ({ until }: Params, ctx: Ctx) => bill(ctx.app, { until: until as string | undefined }),
    },
  },

  subscription: {
    ":subscription": {
      paramSchema: s.number().describe("Subscription id"),
      resolve: async (id: number, ctx: Ctx) => {
        const row = await ctx.app.db.row`SELECT usr_id FROM subscription WHERE id = ${id}`;
        const owner = Number(visible(ctx, row, `subscription ${id}`).usr_id);
        return (await subscriptions(ctx.app, owner)).find((sub) => Number(sub.id) === id);
      },
      get: {
        description: "One subscription with the periods billed so far",
        access: Access.USER,
        execute: async ({ subscription }: Params, ctx: Ctx) => {
          const sub = subscription as Row;
          return { ...sub, periods: await periods(ctx.app, Number(sub.id)) };
        },
      },
      patch: {
        description: "Change it from the next period not billed yet; the start only while nothing was billed",
        access: Access.SUPERUSER,
        input: s.object({ ...VALUES, start: s.optional(s.string()) }),
        execute: async ({ subscription, ...values }: Params, ctx: Ctx) => {
          await update(ctx.app, Number((subscription as Row).id), values as Parameters<typeof update>[2]);
          return { ok: true };
        },
      },
      cancel: {
        post: {
          description: "End it with the period under way: no period begins after it",
          access: Access.USER,
          execute: async ({ subscription }: Params, ctx: Ctx) => {
            await cancel(ctx.app, Number((subscription as Row).id));
            return { ok: true };
          },
        },
      },
    },
  },
};
