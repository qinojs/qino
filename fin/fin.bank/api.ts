import { Access, s, sql } from "@qino/qino";

import { assign } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

/** Statements and their lines are a superuser's. */
export const api: ApiTree = {
  lines: {
    get: {
      description: "Statement lines, newest first; amounts signed, in minor units",
      access: Access.SUPERUSER,
      query: s.object({
        open: s.optional(s.boolean().describe("Only those no payment claims yet")),
        offset: s.optional(s.number()),
      }),
      execute: ({ open, offset }: Params, ctx: Ctx) => ctx.app.db.query`SELECT * FROM bank_tx
        WHERE ${open ? sql`payment_id IS NULL` : sql`${true}`}
        ORDER BY date DESC, id DESC LIMIT 100 OFFSET ${Number(offset ?? 0)}`,
    },
  },
  line: {
    ":line": {
      paramSchema: s.number().describe("Line id"),
      assign: {
        post: {
          description: "Settle a line nobody claimed: it becomes a recorded payment for `ref`; its id comes back",
          access: Access.SUPERUSER,
          input: s.object({ ref: s.string().describe("What it is for: fin.invoice:7") }),
          execute: ({ line, ref }: Params, ctx: Ctx) => assign(ctx.app, Number(line), String(ref)),
        },
      },
    },
  },
};
