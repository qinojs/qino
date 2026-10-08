import { Access, NotFoundError, s, sql } from "@qino/qino";

import { account, balances, book, close, reopen, reverse } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { AccountType } from "./mod.ts";

const DATE = s.string().describe("YYYY-MM-DD");

/** The books are a superuser's. */
export const api: ApiTree = {
  accounts: {
    get: {
      description: "Every account with what is booked on it: up to `to` for the balance sheet, from `from` for "
        + "income and expense. Debit positive, credit negative, in minor units",
      access: Access.SUPERUSER,
      query: s.object({ from: s.optional(DATE), to: s.optional(DATE) }),
      execute: (period: Params, ctx: Ctx) => balances(ctx.app, period as { from?: string; to?: string }),
    },
    post: {
      description: "Create an account, or rename one",
      access: Access.SUPERUSER,
      input: s.object({
        number: s.string(),
        name: s.string(),
        type: s.string().describe("asset, liability, equity, income, expense"),
      }),
      execute: ({ number, name, type }: Params, ctx: Ctx) =>
        account(ctx.app, String(number), { name: String(name), type: type as AccountType }),
    },
  },
  entries: {
    get: {
      description: "The journal of a period, newest first, each entry with its lines",
      access: Access.SUPERUSER,
      query: s.object({ from: s.optional(DATE), to: s.optional(DATE), offset: s.optional(s.number()) }),
      execute: async ({ from, to, offset }: Params, ctx: Ctx) => {
        const db = ctx.app.db;
        const entries = await db.query`SELECT * FROM accounting_entry
          WHERE ${from ? sql`date >= ${from}` : sql`${true}`} AND ${to ? sql`date <= ${to}` : sql`${true}`}
          ORDER BY date DESC, id DESC LIMIT 100 OFFSET ${Number(offset ?? 0)}`;
        const ids = entries.map((e) => e.id);
        const lines = ids.length ? await db.query`
          SELECT l.entry_id, a.number AS account, l.amount, l.tax_code FROM accounting_entry_line l
          JOIN accounting_account a ON a.id = l.account_id WHERE ${sql.in("l.entry_id", ids)}` : [];
        return entries.map((entry) => ({ ...entry, lines: lines.filter((l) => l.entry_id === entry.id) }));
      },
    },
    post: {
      description: "Book an entry: its lines add up to zero and name accounts by number; the id comes back",
      access: Access.SUPERUSER,
      input: s.object({
        date: DATE,
        text: s.string(),
        lines: s.array(s.object({
          account: s.string(),
          amount: s.number().describe("Minor units: debit positive, credit negative"),
          taxCode: s.optional(s.string()),
        })),
        currency: s.optional(s.string().describe("ISO 4217; the main one by default")),
        ref: s.optional(s.string()),
      }),
      execute: (entry: Params, ctx: Ctx) => book(ctx.app, entry as Parameters<typeof book>[1]),
    },
  },
  entry: {
    ":entry": {
      paramSchema: s.number().describe("Entry id"),
      reverse: {
        post: {
          description: "Take it back: the same lines the other way, on `date` (today by default)",
          access: Access.SUPERUSER,
          input: s.object({ date: s.optional(DATE), text: s.optional(s.string()) }),
          execute: async ({ entry, ...options }: Params, ctx: Ctx) => {
            if (!await ctx.app.db.one`SELECT 1 FROM accounting_entry WHERE id = ${entry}`) {
              throw new NotFoundError(`no entry ${entry}`);
            }
            return reverse(ctx.app, Number(entry), options as { date?: string; text?: string });
          },
        },
      },
    },
  },
  close: {
    post: {
      description: "Close the business year that ends on `until`: its result goes to equity, the books are closed",
      access: Access.SUPERUSER,
      input: s.object({ until: DATE }),
      execute: ({ until }: Params, ctx: Ctx) => close(ctx.app, String(until)),
    },
  },
  reopen: {
    post: {
      description: "Open the last closed year again",
      access: Access.SUPERUSER,
      execute: async (_: Params, ctx: Ctx) => {
        await reopen(ctx.app);
        return { ok: true };
      },
    },
  },
};
