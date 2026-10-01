import { Access, NotFoundError, s } from "@qino/qino";

import * as memory from "./lib/memory.ts";
import * as search from "./lib/search.ts";
import { Agent, Session } from "./mod.ts";

import type { ApiTree, Ctx, Params, StandardSchema } from "@qino/qino";

// Anyone signed in may talk with any agent, and change it. A session belongs to the one who started
// it: nobody else sees it, as if it did not exist. In a session the agent acts with its user's rights.

/** How a model is chosen, as ai1 weighs it: `{ quality: 2, cost: 1, speed: 1 }`; empty: the default. */
const prefer = s.optional(s.record(s.number()));

/** What makes an agent: its role, the api paths it may use as tools, prefer. */
const fields = { system: s.optional(s.string()), tools: s.optional(s.array(s.string())), prefer };

const verb = <T extends Params>(description: string, execute: (params: T, ctx: Ctx) => unknown, input?: Record<string, StandardSchema>) =>
  ({ description, access: Access.USER, ...input && { input: s.object(input) }, execute: execute as (params: Params, ctx: Ctx) => unknown });

export const api: ApiTree = {
  agents: {
    post: verb<{ system?: string; tools?: string[]; prefer?: Record<string, number> }>(
      "Create an agent: its role, the paths of the api it may use as tools, and how it chooses its model (ai1 prefer)",
      async (params, ctx) => ({ id: (await Agent.create(ctx.app, params)).id }),
      fields,
    ),
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
          await ctx.app.db.table("ai1_agent").update(agent, {
            ...system !== undefined && { system },
            ...tools && { tools: JSON.stringify(tools) },
            ...prefer && { prefer: JSON.stringify(prefer) },
          });
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
          "Search the agent's memories and all its past sessions, with anyone, by meaning",
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
      get: verb<{ session: number }>("The session: its agent and everything said", async ({ session }, ctx) => ({
        agent: Number(await ctx.app.db.one`SELECT agent_id FROM ai1_session WHERE id = ${session}`),
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
        post: verb<{ session: number; content: string }>(
          "Say something in the session; the agent answers",
          ({ session, content }, ctx) => new Session(ctx.app, session).ask(content),
          { content: s.string() },
        ),
      },
      note: {
        post: verb<{ session: number; content: string }>(
          "Tell the agent something without asking. It reads it with the next question.",
          async ({ session, content }, ctx) => (await new Session(ctx.app, session).note(content), { ok: true }),
          { content: s.string() },
        ),
      },
    },
  },
};
