import { Access, ConflictError, NotFoundError, s, sql } from "@qino/qino";
import { visible, whose, WHOSE } from "@qino/qino/fin";
import { create as pay, methods } from "@qino/qino/fin.payment";

import { cancel, create, creditNote, issue, lines, payerOf, print, refOf, remove, revise, update } from "./mod.ts";

import type { ApiTree, Ctx, Params, Row } from "@qino/qino";

const LINE = s.object({
  name: s.string(),
  description: s.optional(s.string()),
  quantity: s.optional(s.number()),
  unit: s.optional(s.string()),
  price: s.number().describe("Per unit, in minor units, finer if need be: 23.45 is 0.2345 CHF"),
  taxRate: s.optional(s.number().describe("Percent; none: the default (fin.invoice.taxRate)")),
  account: s.optional(s.string().describe("Where bookkeeping books it")),
});

/** What a draft is given; changed, every field is optional. */
const VALUES = {
  currency: s.string().describe("ISO 4217"),
  lines: s.array(LINE),
  taxIncluded: s.optional(s.boolean()),
  party: s.optional(s.record().describe("The other side as printed, shaped like identity.organization")),
  usrId: s.optional(s.number().describe("The user it is for, or from")),
  ref: s.optional(s.string().describe("What it is for: <module>:<id>")),
  text: s.optional(s.string()),
  date: s.optional(s.string().describe("YYYY-MM-DD")),
  due: s.optional(s.string().describe("YYYY-MM-DD")),
  term: s.optional(s.number().describe("Days to pay")),
  number: s.optional(s.string().describe("The sender's, for a received invoice")),
  lang: s.optional(s.string()),
};

/** An invoice as the api shows it; what other modules keep with it (`data`) only to a superuser. */
function shown({ data, ...row }: Row, ctx: Ctx) {
  const json = (value: unknown) => JSON.parse(String(value ?? "null"));
  return { ...row, party: json(row.party), ...ctx.user?.superuser ? { data: json(data) } : {} };
}

/** What is still owed on it, and whether its user can pay that here: an issued invoice of ours. */
const open = (invoice: Row) => Number(invoice.total) - Number(invoice.paid);
const payable = (invoice: Row) =>
  invoice.status === "open" && invoice.direction === "out" && invoice.type === "invoice" && open(invoice) > 0;

/** The ways its user may pay what is open. */
const offered = (ctx: Ctx, invoice: Row) => payable(invoice)
  ? methods(ctx.app, {
    amount: open(invoice),
    currency: String(invoice.currency),
    usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
  })
  : Promise.resolve([]);

/** A superuser does anything here; a user reads their own issued invoices and pays them. */
export const api: ApiTree = {
  invoices: {
    get: {
      description: "Invoices, newest first: one's own issued ones; a superuser asks for another's or all, drafts too",
      access: Access.USER,
      query: s.object({
        status: s.optional(s.string().describe("draft, open, paid, canceled")),
        direction: s.optional(s.string().describe("out: issued, in: received")),
        ...WHOSE,
        offset: s.optional(s.number()),
      }),
      execute: async ({ status, direction, usrId, all, offset }: Params, ctx: Ctx) => {
        const usr = whose(ctx, { usrId, all });
        const where = [
          usr === undefined ? null : sql`usr_id = ${usr}`,
          // one's own are what was sent: drafts only where a superuser looks after others
          usr === ctx.userId ? sql`status <> 'draft'` : null,
          status ? sql`status = ${status}` : null,
          direction ? sql`direction = ${direction}` : null,
        ].flatMap((term) => term ?? []);
        const rows = await ctx.app.db.query`SELECT * FROM invoice
          WHERE ${where.length ? sql.join(where, " AND ") : sql`${true}`}
          ORDER BY id DESC LIMIT 100 OFFSET ${Number(offset ?? 0)}`;
        return rows.map((row) => shown(row, ctx));
      },
    },
    post: {
      description: "A new draft; the id comes back",
      access: Access.SUPERUSER,
      input: s.object({
        ...VALUES,
        direction: s.optional(s.string().describe("out (default): we issue it, in: we received it")),
      }),
      execute: (values: Params, ctx: Ctx) => {
        const direction = values.direction === "in" ? "in" : "out";
        return create(ctx.app, { ...values, direction } as Parameters<typeof create>[1]);
      },
    },
  },

  invoice: {
    ":invoice": {
      paramSchema: s.number().describe("Invoice id"),
      resolve: async (id: number, ctx: Ctx) => {
        const invoice = await ctx.app.db.row`SELECT * FROM invoice WHERE id = ${id}`;
        // a draft is not sent yet: only a superuser sees it
        const draft = invoice?.status === "draft" && !ctx.user?.superuser;
        return visible(ctx, draft ? undefined : invoice, `invoice ${id}`);
      },
      get: {
        description: "One invoice with its lines",
        access: Access.USER,
        execute: async ({ invoice }: Params, ctx: Ctx) => {
          const row = invoice as Row;
          return { ...shown(row, ctx), lines: await lines(ctx.app, Number(row.id)) };
        },
      },
      patch: {
        description: "Change a draft; lines, if given, replace the old ones",
        access: Access.SUPERUSER,
        input: s.object({ ...VALUES, currency: s.optional(VALUES.currency), lines: s.optional(VALUES.lines) }),
        execute: async ({ invoice, ...values }: Params, ctx: Ctx) => {
          await update(ctx.app, Number((invoice as Row).id), values as Parameters<typeof update>[2]);
          return { ok: true };
        },
      },
      delete: {
        description: "Throw a draft away",
        access: Access.SUPERUSER,
        execute: async ({ invoice }: Params, ctx: Ctx) => {
          await remove(ctx.app, Number((invoice as Row).id));
          return { ok: true };
        },
      },
      pdf: {
        get: {
          description: "Where to download it as PDF — the print of an issued invoice, the original of a received "
          + "one — signed for this session, for some hours",
          access: Access.USER,
          execute: async ({ invoice }: Params, ctx: Ctx) => {
            const row = invoice as Row;
            const app = ctx.app;
            if (row.status === "draft") throw new ConflictError("a draft has no PDF yet");
            const file = row.file_id
              ? await app.dbFiles.file(Number(row.file_id))
              : row.direction === "out" ? await print(app, Number(row.id)) : undefined;
            if (!await file?.exists()) throw new NotFoundError("no file");
            // signed for the session that asked: the download needs no other right
          return { name: file!.name, url: new URL(await file!.url({ grant: "session" }), await app.url()).href };
          },
        },
      },
      methods: {
        get: {
          description: "The ways to pay what is open on it: `method` and `label`",
          access: Access.USER,
          execute: ({ invoice }: Params, ctx: Ctx) => offered(ctx, invoice as Row),
        },
      },
      pay: {
        post: {
          description: "Start paying what is open, by one of its methods; `redirect` is where the payer goes on",
          access: Access.USER,
          input: s.object({
            method: s.string().describe("As `methods` lists it, or just the provider to choose there"),
            return: s.optional(s.string().describe("Where the payer lands afterwards, paid or not")),
          }),
          execute: async ({ invoice, method, return: back }: Params, ctx: Ctx) => {
            const row = invoice as Row;
            const ways = (await offered(ctx, row)).map((m) => m.method);
            if (!ways.some((way) => way === method || way.split(".")[0] === method)) {
              throw new ConflictError("not payable that way");
            }
            return await pay(ctx.app, {
              method: String(method),
              amount: open(row),
              currency: String(row.currency),
              ref: refOf(Number(row.id)),
              description: String(row.number ?? ""),
              usrId: row.usr_id == null ? undefined : Number(row.usr_id),
              payer: payerOf(row),
              return: String(back ?? "/"),
            });
          },
        },
      },
      issue: { post: action("Issue a draft: it draws its number and is owed", issue) },
      cancel: { post: action("Withdraw it; its number stays used", cancel) },
      revise: { post: action("Cancel an open invoice nothing was paid on, for a draft with its content", revise) },
      creditNote: { post: action("A draft credit note for an issued invoice of ours", creditNote) },
    },
  },
};

/** A superuser's step on one invoice; what it returns comes back. */
function action(description: string, fn: (app: Ctx["app"], id: number) => Promise<unknown>) {
  return {
    description,
    access: Access.SUPERUSER,
    execute: ({ invoice }: Params, ctx: Ctx) => fn(ctx.app, Number((invoice as Row).id)),
  };
}
