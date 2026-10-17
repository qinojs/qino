// deno-lint-ignore-file no-explicit-any
import { Access, errMsg, getCtx, NotFoundError, s, sql, toTools, unixTime } from "@qino/qino";
import { collection, index, search } from "@qino/qino/ai.embed";
import { hit, sqlScore } from "@qino/qino/score";
import { Session } from "@qino/qino/ai.agent";

import { IN_MIND, personal } from "./mod.ts";

import type { ApiTree, App, Ctx, Usr } from "@qino/qino";

// What agents keep about a user: their language, how to address them, their preferences. It is theirs
// with every agent, and only in their own sessions. Hooked into ai.agent, it can be left out or
// replaced by another module.

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** Only memories this close to what the user said come to mind (as with ai.agent). */
const CLOSE = 0.75; // todo? adjustable

const log = (e: unknown) => console.error("[ai.user_memory] embedding:", errMsg(e));

/** Memories read at a time, until `chars` are filled. */
const BLOCK = 100;

/** The user's memories, the strongest first; with `chars`, those that fit in as many characters. */
async function list(app: App, usr: number, chars = Infinity) {
  const out = [];
  let used = 0;
  for (let at = 0;; at += BLOCK) {
    const rows = await app.db.query`SELECT id, content FROM ai_user_memory m WHERE usr_id = ${usr}
      ORDER BY ${sqlScore(app.db, "ai_user_memory_use", { memory_id: sql`m.id` })} DESC, id LIMIT ${BLOCK} OFFSET ${at}`;
    for (const r of rows) {
      if ((used += String(r.content).length) > chars) return out;
      out.push(r);
    }
    if (rows.length < BLOCK) return out;
  }
}

async function own(app: App, usr: number, id: number) {
  if (!await app.db.one`SELECT id FROM ai_user_memory WHERE id = ${id} AND usr_id = ${usr}`) throw new NotFoundError("No such memory");
}

async function keep(app: App, usr: number, content: string, replaces?: number) {
  const table = app.db.table("ai_user_memory"), values = { usr_id: usr, content, time: unixTime() };
  const id = replaces ? (await own(app, usr, replaces), await table.update(replaces, values), replaces) : Number(await table.insert(values));
  hit(app.db, "ai_user_memory_use", { memory_id: id });
  if (await collection(app)) index(app, "ai_user_memory", { usr_id: usr, memory_id: id }, content).catch(log); // findable by meaning
  return { id: `u${id}` };
}

/** The signed-in user's memories: to see and change them, and the agents' tools for them. */
export const api: ApiTree = {
  memories: {
    get: { description: "The memories every agent keeps about you", access: Access.USER, execute: (_: unknown, ctx: Ctx) => list(ctx.app, ctx.userId) },
    post: {
      description: "Keep a short fact about who the user is (name, language, how to address them), for every agent; or replace one of theirs (u5: replaces 5)",
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
          await ctx.app.db.table("ai_user_memory").delete(memory);
          return { forgotten: `u${memory}` };
        },
      },
    },
  },
};

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  // into every turn: who the user is and what is known about them, and the tool to forget it; what is new about
  // them, decide sorts out when the agent remembers it (below)
  app.on("ai.agent:turn", async (turn) => {
    const memories = await list(app, turn.usrId, IN_MIND);
    const usr = await app.db.table("usr").get<Usr>(turn.usrId);
    const name = [usr?.given_name, usr?.family_name].filter(Boolean).join(" ") || usr?.username;
    const who = [name, await usr?.contact("email"), `id ${turn.usrId}`].filter(Boolean).join(", ");
    turn.parts.push(`## User: ${who}\nKnown to every agent, in every session with them.` +
      memories.map((m) => `\n[u${m.id}] ${m.content}`).join(""));
    turn.known.push(...memories.map((m) => `u${m.id}`));
    turn.tools.push(...toTools({ user: app.apiTree["ai.user_memory"] }, { apis: { "/user/memories/:memory": ["delete"] } }));
  }, { signal });

  // what the user says strengthens their memories close to it, the closer the more; those not given yet
  // in the session come to mind, as a note the agent reads with its next step
  app.on("ai.agent:associate", async ({ session: id, vector }) => {
    const usr = await app.db.one`SELECT usr_id FROM ai_session WHERE id = ${id}`;
    const close = await search(app, { ai_user_memory: sql`e.usr_id = ${usr}` }, vector, { limit: 5 }).catch((e) => (log(e), []));
    for (const { key, score } of close) if (score >= CLOSE) hit(app.db, "ai_user_memory_use", { memory_id: Number(key.memory_id) }, score);
    const session = new Session(app, id), known = await session.known(), lines = new Map<string, string>();
    for (const { key, content, score } of close) {
      const id = `u${key.memory_id}`; // the nearest chunk of each
      if (score >= CLOSE && !known.has(id) && !lines.has(id)) lines.set(id, `[${id}] ${content}`);
    }
    const near = [...lines].slice(0, 3);
    if (near.length) await session.note(`## Possibly relevant memories about the user\n${near.map(([, line]) => line).join("\n")}`, { known: near.map(([id]) => id) });
  }, { signal });

  // a new memory about the person is theirs, not the agent's
  app.on("ai.agent:remember", async (memory) => {
    if ((await personal(app, memory.content).catch(() => undefined))?.choice !== "personal") return;
    memory.prevent = true;
    memory.result = await keep(app, getCtx().userId, memory.content);
  }, { signal });
}
