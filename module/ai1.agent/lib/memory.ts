import { NotFoundError, unixTime } from "@qino/qino";
import { hit, sqlScore } from "@qino/qino/score";

import { keep } from "./search.ts";

import type { App, Tool } from "@qino/qino";

// The agent's memory: short facts it keeps across sessions, always in its context, the strongest
// first. What it keeps renewing stays strong, the rest fades (score).

/** The memories for the context, or nothing while the agent remembers nothing. */
export async function index(app: App, agent: number): Promise<string> {
  const rows = await app.db.query`SELECT id, content FROM ai1_agent_memory m WHERE agent_id = ${agent}
    ORDER BY ${sqlScore(app.db, "ai1_agent_memory", "m.id")} DESC, id`;
  return rows.length ? `Your memories:\n${rows.map((r) => `[${r.id}] ${r.content}`).join("\n")}` : "";
}

/** remember and forget: every agent has them. */
export const tools = (app: App, agent: number): Tool[] => {
  const table = app.db.table("ai1_agent_memory");
  const own = async (id: unknown) => {
    if (!await app.db.one`SELECT id FROM ai1_agent_memory WHERE id = ${Number(id)} AND agent_id = ${agent}`) throw new NotFoundError("No such memory");
  };
  return [{
    name: "remember",
    description: "Keep a short fact across sessions, or replace one of your memories by its id. Everyone who talks with you shares your memories.",
    parameters: { type: "object", properties: { content: { type: "string" }, replaces: { type: "integer" } }, required: ["content"] },
    execute: async (args) => {
      const { content, replaces } = args as { content: string; replaces?: number };
      const values = { agent_id: agent, content, time: unixTime() };
      const id = replaces ? (await own(replaces), await table.update(replaces, values), replaces) : Number(await table.insert(values));
      hit(app.db, "ai1_agent_memory", id);
      keep(app, "ai1_agent_memory", { agent_id: agent, memory_id: id }, content);
      return { id };
    },
  }, {
    name: "forget",
    description: "Drop one of your memories by its id: one the user asks you to forget, or one that no longer holds. If there is a newer version, replace it with remember instead.",
    parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    execute: async (args) => {
      const { id } = args as { id: number };
      await own(id);
      await table.delete(id);
      return "forgotten";
    },
  }];
};
