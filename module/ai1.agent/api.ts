import { Access, errMsg, NotFoundError, s } from "@qino/qino";

import * as memory from "./lib/memory.ts";
import * as search from "./lib/search.ts";
import { checkTools } from "./lib/turn.ts";
import { Agent, Session } from "./mod.ts";

import type { ApiTree, Ctx, Params, StandardSchema } from "@qino/qino";

// Anyone signed in may talk with any agent, and change it. A session belongs to the one who started
// it: nobody else sees it, as if it did not exist. In a session the agent acts with its user's rights.

/** How a model is chosen, as ai1 weighs it: `{ quality: 2, cost: 1, speed: 1 }`; empty: the default. */
const prefer = s.optional(s.record(s.number()));

/** What makes an agent: its role, the tools it may use, prefer. */
const fields = {
  system: s.optional(s.string()),
  tools: s.optional(s.array(s.string()).describe("Tool names, or prefix_* for all below a path (cms_*, cms_node_*)")),
  prefer,
};

const verb = <T extends Params>(description: string, execute: (params: T, ctx: Ctx) => unknown, input?: Record<string, StandardSchema>) =>
  ({ description, access: Access.USER, ...input && { input: s.object(input) }, execute: execute as (params: Params, ctx: Ctx) => unknown });

export const api: ApiTree = {
  agents: {
    get: {
      description: "Find agents by their role: id and the first line of it; with search those nearest to it by meaning",
      query: s.object({ search: s.optional(s.string()).describe("What the agent should do, in words") }),
      access: Access.USER,
      execute: ({ search: query }: { search?: string }, ctx: Ctx) => search.agents(ctx.app, query),
    },
    post: verb<{ system?: string; tools?: string[]; prefer?: Record<string, number> }>(
      "Create an agent: its role, the tools it may use, and how it chooses its model (ai1 prefer)",
      async (params, ctx) => ({ id: (await Agent.create(ctx.app, params)).id }),
      fields,
    ),
  },
  agent: {
    ":agent": {
      paramSchema: s.number().describe("Agent ID"),
      resolve: async (id: unknown, ctx: Ctx) => {
        if (!await ctx.app.db.one`SELECT id FROM ai1_agent WHERE id = ${id}`) throw new NotFoundError("No such agent");
        return id;
      },
      get: verb<{ agent: number }>("The agent: its role and tools", async ({ agent }, ctx) => {
        const row = (await ctx.app.db.row`SELECT id, system, tools, prefer FROM ai1_agent WHERE id = ${agent}`)!;
        return { id: agent, system: row.system, tools: JSON.parse(String(row.tools || "[]")), prefer: JSON.parse(String(row.prefer || "{}")) };
      }),
      patch: verb<{ agent: number; system?: string; tools?: string[]; prefer?: Record<string, number> }>(
        "Change the agent's role, tools or prefer",
        async ({ agent, system, tools, prefer }, ctx) => {
          if (tools) checkTools(ctx.app, tools);
          await ctx.app.db.table("ai1_agent").update(agent, {
            ...system !== undefined && { system },
            ...tools && { tools: JSON.stringify(tools) },
            ...prefer && { prefer: JSON.stringify(prefer) },
          });
          if (system !== undefined) search.keep(ctx.app, "ai1_agent", { agent_id: agent }, system); // findable as it is now
          return { id: agent };
        },
        fields,
      ),
      sessions: {
        post: verb<{ agent: number; prefer?: Record<string, number> }>(
          "Start a session with the agent, as yourself; prefer replaces the agent's in it",
          async ({ agent, prefer }, ctx) => ({ id: (await new Agent(ctx.app, agent).start(ctx.userId, { prefer })).id }),
          { prefer },
        ),
      },
      memories: {
        get: verb<{ agent: number }>("The agent's memories, the strongest first", ({ agent }, ctx) => memory.list(ctx.app, agent)),
        post: verb<{ agent: number; content: string; replaces?: number }>(
          "Keep a short fact across sessions, or replace a memory by its id. Everyone who talks with the agent shares its memories.",
          ({ agent, content, replaces }, ctx) => memory.remember(ctx.app, agent, content, replaces),
          { content: s.string(), replaces: s.optional(s.number()) },
        ),
        ":memory": {
          paramSchema: s.number().describe("Memory ID"),
          delete: verb<{ agent: number; memory: number }>(
            "Forget a memory: one the user asks to forget, or one that no longer holds. If there is a newer version, replace it instead.",
            ({ agent, memory: id }, ctx) => memory.forget(ctx.app, agent, id),
          ),
        },
      },
      search: {
        post: verb<{ agent: number; query: string }>(
          "Search this agent's own memory, by meaning: its memories and all its past sessions, with anyone",
          ({ agent, query }, ctx) => search.find(ctx.app, agent, query),
          { query: s.string() },
        ),
      },
    },
  },
  sessions: {
    ":session": {
      paramSchema: s.number().describe("Session ID"),
      resolve: async (id: unknown, ctx: Ctx) => {
        const usr = Number(await ctx.app.db.one`SELECT usr_id FROM ai1_session WHERE id = ${id}`);
        if (!ctx.userId || usr !== ctx.userId) throw new NotFoundError("No such session");
        return id;
      },
      get: verb<{ session: number }>("The session: its agent, everything said, and whether an answer is on its way", async ({ session }, ctx) => ({
        agent: Number(await ctx.app.db.one`SELECT agent_id FROM ai1_session WHERE id = ${session}`),
        running: new Session(ctx.app, session).running,
        messages: (await ctx.app.db.query`SELECT m.id, m.time, m.message, am.name AS model, p.name AS provider
          FROM ai1_session_message m
          LEFT JOIN ai1_model_provider mp ON mp.id = m.model_provider_id
          LEFT JOIN ai1_model am ON am.id = mp.model_id
          LEFT JOIN ai1_provider p ON p.id = mp.provider_id
          WHERE m.session_id = ${session} ORDER BY m.id`)
          .map((m) => ({
            id: m.id, time: m.time, model: m.model || undefined, provider: m.provider || undefined,
            ...JSON.parse(String(m.message)),
          })),
      })),
      ask: {
        post: verb<{ session: number; content: string; wait?: boolean }>(
          "Say something in the session; the agent answers in the background, its steps and errors kept in the session; with wait the answer",
          ({ session, content, wait }, ctx) => {
            const answer = new Session(ctx.app, session).ask(content);
            if (wait) return answer;
            answer.catch((e) => console.error("[ai1.agent] ask:", errMsg(e))); // kept in the session too
            return { running: true };
          },
          { content: s.string(), wait: s.optional(s.boolean()) },
        ),
      },
      cancel: {
        post: verb<{ session: number }>(
          "Stop the answer on its way; what was said and done so far stays",
          ({ session }, ctx) => ({ cancelled: new Session(ctx.app, session).cancel() }),
        ),
      },
      note: {
        post: verb<{ session: number; content: string }>(
          "Give the agent system context, without a question; it gets it with the next one.",
          async ({ session, content }, ctx) => (await new Session(ctx.app, session).note(content), { ok: true }),
          { content: s.string() },
        ),
      },
    },
  },
};
