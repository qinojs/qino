import { NotFoundError, sql, unixTime } from "@qino/qino";
import { hit, sqlScore } from "@qino/qino/score";

import { keep } from "./search.ts";

import type { App } from "@qino/qino";

// The agent's memory: short facts it keeps across sessions, always in its context, the strongest
// first. What it keeps renewing stays strong, the rest fades (score).

/** The characters of memories in the context, the strongest first; the weaker ones are left to its search. */
export const IN_MIND = 8000; // todo? adjustable
/** Memories read at a time, until `chars` are filled. */
const BLOCK = 100;

/** Its memories, the strongest first; with `chars`, those that fit in as many characters. */
export async function list(app: App, agent: number, chars = Infinity): Promise<{ id: number; content: string }[]> {
  const out = [];
  let used = 0;
  for (let at = 0;; at += BLOCK) {
    const rows = await app.db.query`SELECT id, content FROM ai_agent_memory m WHERE agent_id = ${agent}
      ORDER BY ${sqlScore(app.db, "ai_agent_memory_use", { memory_id: sql`m.id` })} DESC, id LIMIT ${BLOCK} OFFSET ${at}`;
    for (const r of rows) {
      if ((used += String(r.content).length) > chars) return out;
      out.push({ id: Number(r.id), content: String(r.content) });
    }
    if (rows.length < BLOCK) return out;
  }
}

/** Told to the agent above its memories. */
export const HINT = "Save durable knowledge with post_memories: rules, preferences, workflows, corrections, solutions worth reusing. Before each final answer, check: learned something lasting? Then save first. Update instead of duplicating; skip temporary details.";

/** The strongest memories for the context, under the hint on how to keep them. */
export async function index(app: App, agent: number): Promise<string> {
  const memories = await list(app, agent, IN_MIND);
  return `## Your memories\n${HINT}${memories.map((m) => `\n[${m.id}] ${m.content}`).join("")}`;
}

async function own(app: App, agent: number, id: number) {
  if (!await app.db.one`SELECT id FROM ai_agent_memory WHERE id = ${id} AND agent_id = ${agent}`) throw new NotFoundError("No such memory");
}

/** Keep a short fact, or replace the memory `replaces`; either grows stronger. Another module may
 *  keep a new one instead (`ai.agent:remember`, `prevent`). */
export async function remember(app: App, agent: number, content: string, replaces?: number): Promise<unknown> {
  const taken = replaces ? undefined : await app.fire("ai.agent:remember", { agent, content, prevent: false, result: undefined as unknown });
  if (taken?.prevent) return taken.result;
  const table = app.db.table("ai_agent_memory"), values = { agent_id: agent, content, time: unixTime() };
  const id = replaces ? (await own(app, agent, replaces), await table.update(replaces, values), replaces) : Number(await table.insert(values));
  hit(app.db, "ai_agent_memory_use", { memory_id: id });
  keep(app, "ai_agent_memory", { agent_id: agent, memory_id: id }, content);
  return { id };
}

export async function forget(app: App, agent: number, id: number): Promise<{ forgotten: number }> {
  await own(app, agent, id);
  await app.db.table("ai_agent_memory").delete(id);
  return { forgotten: id };
}
