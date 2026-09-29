// deno-lint-ignore-file no-explicit-any
import { Access, errMsg, getCtx, NotFoundError, s, sql, toTools, unixTime } from "@qino/qino";
import { collection, index, search } from "@qino/qino/ai1.embed";
import { hit, scored, sqlScore } from "@qino/qino/score";

import { personal } from "./mod.ts";

import type { ApiTree, App, Ctx } from "@qino/qino";

// What agents keep about a user: their language, how to address them, their preferences. It is theirs
// with every agent, and only in their own sessions. Hooked into ai1.agent, it can be left out or
// replaced by another module.

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** How many of a user's memories are in the context: the strongest, those kept most and latest. */
const IN_MIND = 10; // todo? adjustable

/** Only memories this close to what the user said come to mind (as with ai1.agent). */
const CLOSE = 0.75; // todo? adjustable

const log = (e: unknown) => console.error("[ai1.user_memory] embedding:", errMsg(e));

const list = (app: App, usr: number, limit?: number) => app.db.query`SELECT id, content FROM ai1_user_memory m WHERE usr_id = ${usr}
  ORDER BY ${sqlScore(app.db, "ai1_user_memory", "m.id")} DESC, id ${limit ? sql`LIMIT ${limit}` : sql``}`;

async function own(app: App, usr: number, id: number): Promise<void> {
  if (!await app.db.one`SELECT id FROM ai1_user_memory WHERE id = ${id} AND usr_id = ${usr}`) throw new NotFoundError("No such memory");
}

async function keep(app: App, usr: number, content: string, replaces?: number): Promise<{ id: string }> {
  const table = app.db.table("ai1_user_memory"), values = { usr_id: usr, content, time: unixTime() };
  const id = replaces ? (await own(app, usr, replaces), await table.update(replaces, values), replaces) : Number(await table.insert(values));
  hit(app.db, "ai1_user_memory", id);
  if (await collection(app)) index(app, "ai1_user_memory", { usr_id: usr, memory_id: id }, content).catch(log); // findable by meaning
  return { id: `u${id}` };
}

/** The signed-in user's memories: to see and change them, and the agents' tools for them. */
export const api: ApiTree = {
  memories: {
    get: { description: "The memories every agent keeps about you", access: Access.USER, execute: (_: unknown, ctx: Ctx) => list(ctx.app, ctx.userId) },
    post: {
      description: "Keep a short fact about the user you talk with (their language, how to address them, their preferences), for every agent; or replace one of theirs (u5: replaces 5)",
      input: s.object({ content: s.string(), replaces: s.optional(s.number()) }),
      access: Access.USER,
      execute: ({ content, replaces }: any, ctx: Ctx) => keep(ctx.app, ctx.userId, content, replaces),
    },
    ":memory": {
      paramSchema: s.number().describe("Memory ID, without the u"),
      delete: {
        description: "Forget one of the user's memories (u5: memory 5)",
        access: Access.USER,
        execute: async ({ memory }: any, ctx: Ctx) => {
          await own(ctx.app, ctx.userId, memory);
          await ctx.app.db.table("ai1_user_memory").delete(memory);
          return { forgotten: `u${memory}` };
        },
      },
    },
  },
};

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await scored(app.db, "ai1_user_memory", 30 * 86400);

  // into every turn: what is known about the user, and the tool to forget it; what is new about
  // them, decide sorts out when the agent remembers it (below)
  app.on("ai1.agent:turn", async (turn) => {
    const memories = await list(app, turn.usrId, IN_MIND);
    if (memories.length) turn.parts.push(`About the user you talk with:\n${memories.map((m) => `[u${m.id}] ${m.content}`).join("\n")}`);
    turn.tools.push(...toTools({ user: app.apiTree["ai1.user_memory"] }, { apis: { "/user/memories/:memory": ["delete"] } }));
  }, { signal });

  // what the user says strengthens their memories close to it, the closer the more
  app.on("ai1.agent:associate", async ({ session, vector }) => {
    const usr = await app.db.one`SELECT usr_id FROM ai1_session WHERE id = ${session}`;
    const close = await search(app, { ai1_user_memory: sql`e.usr_id = ${usr}` }, vector, { limit: 5 }).catch((e) => (log(e), []));
    for (const { key, score } of close) if (score >= CLOSE) hit(app.db, "ai1_user_memory", Number(key.memory_id), score);
  }, { signal });

  // a new memory about the person is theirs, not the agent's
  app.on("ai1.agent:remember", async (memory) => {
    if ((await personal(app, memory.content).catch(() => undefined))?.choice !== "personal") return;
    memory.prevent = true;
    memory.result = await keep(app, getCtx().userId, memory.content);
  }, { signal });
}
