import { Access, s, sql } from "@qino/qino";
import { ownerOf, visible } from "@qino/qino/fin";

import { cancel, record, refund, sync } from "./mod.ts";

import type { ApiTree, Ctx, Params, Row } from "@qino/qino";

/** A payment as the api shows it; the provider's own state (`data`) only to a superuser. */
function shown({ data, ...row }: Row, ctx: Ctx) {
  const json = (value: unknown) => JSON.parse(String(value ?? "null"));
  return { ...row, payer: json(row.payer), ...ctx.user?.superuser ? { data: json(data) } : {} };
}

/** A superuser does anything here; a user reads their own payments. Paying an invoice starts at
 *  the invoice (`fin.invoice/<id>/pay`); what moved only a provider or the bank says. */
export const api: ApiTree = {
  payments: {
    get: {
      description: "Payments, newest first: the user's own, all for a superuser",
      access: Access.USER,
      query: s.object({
        status: s.optional(s.string().describe("pending, processing, paid, failed, canceled, expired, refunded")),
        ref: s.optional(s.string().describe("What it is for: fin.invoice:7")),
        usrId: s.optional(s.number().describe("Only this user's (superuser)")),
        offset: s.optional(s.number()),
      }),
      execute: async ({ status, ref, usrId, offset }: Params, ctx: Ctx) => {
        const owner = ownerOf(ctx);
        const where = [
          owner === undefined ? usrId ? sql`usr_id = ${usrId}` : null : sql`usr_id = ${owner}`,
          status ? sql`status = ${status}` : null,
          ref ? sql`ref = ${ref}` : null,
        ].flatMap((term) => term ?? []);
        const rows = await ctx.app.db.query`SELECT * FROM payment
          WHERE ${where.length ? sql.join(where, " AND ") : sql`${true}`}
          ORDER BY id DESC LIMIT 100 OFFSET ${Number(offset ?? 0)}`;
        return rows.map((row) => shown(row, ctx));
      },
    },
    post: {
      description: "Record what moved without a provider flow — cash, a transfer by hand; the id comes back",
      access: Access.SUPERUSER,
      input: s.object({
        direction: s.string().describe("in or out"),
        provider: s.string().describe("Where it came from: cash, bank …"),
        method: s.optional(s.string()),
        amount: s.number().describe("Minor units"),
        paid: s.optional(s.number().describe("Minor units; the whole amount by default")),
        currency: s.string().describe("ISO 4217"),
        ref: s.optional(s.string().describe("What it is for: fin.invoice:7")),
        description: s.optional(s.string()),
        usrId: s.optional(s.number()),
      }),
      execute: (values: Params, ctx: Ctx) => {
        const direction = values.direction === "out" ? "out" : "in";
        return record(ctx.app, { ...values, direction } as Parameters<typeof record>[1]);
      },
    },
  },

  payment: {
    ":payment": {
      paramSchema: s.number().describe("Payment id"),
      resolve: async (id: number, ctx: Ctx) =>
        visible(ctx, await ctx.app.db.row`SELECT * FROM payment WHERE id = ${id}`, `payment ${id}`),
      get: {
        description: "One payment",
        access: Access.USER,
        execute: ({ payment }: Params, ctx: Ctx) => shown(payment as Row, ctx),
      },
      sync: { post: action("Ask the provider how it stands, and store what it says", sync) },
      cancel: { post: action("Withdraw it while nobody has started paying", cancel) },
      refund: {
        post: {
          description: "Pay back, by default all that is left",
          access: Access.SUPERUSER,
          input: s.object({ amount: s.optional(s.number().describe("Minor units")) }),
          execute: ({ payment, amount }: Params, ctx: Ctx) =>
            refund(ctx.app, Number((payment as Row).id), amount == null ? undefined : Number(amount)),
        },
      },
    },
  },
};

/** A superuser's step on one payment; the payment comes back as it is then. */
function action(description: string, fn: (app: Ctx["app"], id: number) => Promise<unknown>) {
  return {
    description,
    access: Access.SUPERUSER,
    execute: ({ payment }: Params, ctx: Ctx) => fn(ctx.app, Number((payment as Row).id)),
  };
}
