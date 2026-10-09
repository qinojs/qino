import { Access, NotFoundError, s } from "@qino/qino";

import { schedule } from "./lib/session.compaction.ts";

import type { ApiTree, Ctx } from "@qino/qino";

// A session is its user's; a superuser may act on all.
export const api: ApiTree = {
  sessions: {
    ":session": {
      paramSchema: s.number().describe("Session ID"),
      resolve: async (id: unknown, ctx: Ctx) => {
        const usr = Number(await ctx.app.db.one`SELECT usr_id FROM ai_session WHERE id = ${id}`);
        if (!usr || (usr !== ctx.userId && !ctx.user?.superuser)) throw new NotFoundError("No such session");
        return id;
      },
      compact: {
        post: {
          description: "Compact the session after its current or next answer: from then on a summary and the last turns are sent instead of all",
          access: Access.USER,
          execute: ({ session }: { session: number }, ctx: Ctx) => (schedule(ctx.app, session), { ok: true }),
        },
      },
    },
  },
};
