import { NotFoundError, sql, unixTime } from "@qino/qino";
import { hit, sqlScore } from "@qino/qino/score";

import { keep } from "./search.ts";

import type { App } from "@qino/qino";

// The agent's memory: short facts it keeps across sessions, always in its context, the strongest
// first. What it keeps renewing stays strong, the rest fades (score).

/** How many memories are in the context; the weaker ones are left to its search. */
export const IN_MIND = 10;

/** Its memories, the strongest first. */
export async function list(app: App, agent: number, limit?: number): Promise<{ id: number; content: string }[]> {
  return (await app.db.query`SELECT id, content FROM ai1_agent_memory m WHERE agent_id = ${agent}
    ORDER BY ${sqlScore(app.db, "ai1_agent_memory", "m.id")} DESC, id ${limit ? sql`LIMIT ${limit}` : sql``}`).map((r) => ({ id: Number(r.id), content: String(r.content) }));
}

/** Told to the agent above its memories. */
export const HINT = "Save durable knowledge with post_memories: rules, preferences, workflows, corrections, solutions worth reusing. Before each final answer, check: learned something lasting? Then save first. Update instead of duplicating; skip temporary details.";

/** The strongest memories for the context, under the hint on how to keep them. */
export async function index(app: App, agent: number): Promise<string> {
  const memories = await list(app, agent, IN_MIND);
  return `## Your memories\n${HINT}${memories.map((m) => `\n[${m.id}] ${m.content}`).join("")}`;
}

async function own(app: App, agent: number, id: number) {
  if (!await app.db.one`SELECT id FROM ai1_agent_memory WHERE id = ${id} AND agent_id = ${agent}`) throw new NotFoundError("No such memory");
}

/** Keep a short fact, or replace the memory `replaces`; either grows stronger. Another module may
 *  keep a new one instead (`ai1.agent:remember`, `prevent`). */
export async function remember(app: App, agent: number, content: string, replaces?: number): Promise<unknown> {
  const taken = replaces ? undefined : await app.fire("ai1.agent:remember", { agent, content, prevent: false, result: undefined as unknown });
  if (taken?.prevent) return taken.result;
  const table = app.db.table("ai1_agent_memory"), values = { agent_id: agent, content, time: unixTime() };
  const id = replaces ? (await own(app, agent, replaces), await table.update(replaces, values), replaces) : Number(await table.insert(values));
  hit(app.db, "ai1_agent_memory", id);
  keep(app, "ai1_agent_memory", { agent_id: agent, memory_id: id }, content);
  return { id };
}

export async function forget(app: App, agent: number, id: number): Promise<{ forgotten: number }> {
  await own(app, agent, id);
  await app.db.table("ai1_agent_memory").delete(id);
  return { forgotten: id };
}
