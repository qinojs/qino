import { Access, NotFoundError, s } from "@qino/qino";

import { apply, sleep } from "./lib/agent.sleep.ts";
import { schedule } from "./lib/session.compaction.ts";

import type { ApiTree, Ctx } from "@qino/qino";

// A session is its user's; a superuser may act on all. The nights are the superuser's.
export const api: ApiTree = {
  sleeps: {
    get: {
      description: "The latest nights of the agents: what each went over, and its plan for the memories",
      access: Access.SUPERUSER,
      execute: async (_: unknown, ctx: Ctx) => (await ctx.app.db.query`SELECT id, agent_id, time, until, stage, plan, error FROM ai_agent_sleep ORDER BY id DESC LIMIT 20`)
        .map((row) => ({ ...row, plan: row.plan ? JSON.parse(String(row.plan)) : undefined })),
    },
    post: {
      description: "Let the agents sleep now, or only one, as they do every night: what they go over comes back as a plan later",
      access: Access.SUPERUSER,
      input: s.object({ agent: s.optional(s.number().describe("Only this agent")) }),
      execute: async ({ agent }: { agent?: number }, ctx: Ctx) => ({ asleep: await sleep(ctx.app, agent) }),
    },
    ":sleep": {
      paramSchema: s.number().describe("Sleep ID"),
      apply: {
        post: {
          description: "Carry out a night's plan for the memories, after reviewing it",
          access: Access.SUPERUSER,
          execute: async ({ sleep }: { sleep: number }, ctx: Ctx) => (await apply(ctx.app, sleep), { ok: true }),
        },
      },
    },
  },
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
