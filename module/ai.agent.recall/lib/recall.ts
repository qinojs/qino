import { sql } from "@qino/qino";
import { search } from "@qino/qino/ai.embed";
import { all, find } from "@qino/qino/ai.discover";
import { Agent, CALL, Session } from "@qino/qino/ai.agent";

import type { App } from "@qino/qino";

/** Only what is this close to what was said comes to mind. */
const CLOSE = 0.65; // todo? adjustable
/** Of each kind at most this many, the nearest. */
const MOST = 3;

/** The agent's memories close to `vector` and not in the context, by id: `[id] content`. */
async function memories(app: App, agent: number, vector: number[], known: Set<string>) {
  const lines = new Map<string, string>();
  for (const { key, content, score } of await search(app, { ai_agent_memory: sql`e.agent_id = ${agent}` }, vector, { limit: MOST * 3 })) {
    const id = String(key.memory_id); // the nearest chunk of each
    if (score >= CLOSE && !known.has(id) && !lines.has(id)) lines.set(id, `[${id}] ${content}`);
  }
  return [...lines].slice(0, MOST);
}

/** Messages shorter than this ("ok", "go on") are close to too much to come to mind. */
const SHORT = 40;
/** Of a message at most this many characters: the rest it can read on, by its id. */
const LONG = 1000;

/** What was said earlier in session `id`, close to `vector` and no longer sent (compacted), by id and who
 *  said it: `[#7 user] content`. */
async function said(app: App, agent: number, id: number, vector: number[], known: Set<string>) {
  const lines = new Map<string, string>();
  const mine = sql`e.agent_id = ${agent} AND e.message_id IN (SELECT id FROM ai_session_message WHERE session_id = ${id})`;
  const hits = await search(app, { ai_session_message: mine }, vector, { limit: MOST * 3 });
  const roles = new Map((await app.db.query`SELECT id, message FROM ai_session_message WHERE ${sql.in("id", hits.map((h) => h.key.message_id))}`)
    .map((m) => [`#${m.id}`, JSON.parse(String(m.message)).role]));
  for (const { key, content, score } of hits) {
    const ref = `#${key.message_id}`;
    if (score < CLOSE || content.length < SHORT || known.has(ref) || lines.has(ref)) continue;
    lines.set(ref, `[${ref} ${roles.get(ref)}] ${content.length > LONG ? content.slice(0, LONG) + "…" : content}`);
  }
  return [...lines].slice(0, MOST);
}

/** The agent's tools close to `vector` and not in the context, by name: `- name: what it does`. */
async function tools(app: App, agent: number, vector: number[], known: Set<string>) {
  const left = new Map((await new Agent(app, agent).allowed()).filter((tool) => !known.has(tool.name)).map((tool) => [tool.name, tool]));
  if (!left.size) return [];
  const near = await find(app, "tools", vector, all(app, "tools").filter((e) => left.has(e.name)), MOST);
  return near.filter((e) => (e.score ?? 0) >= CLOSE).map((e) => [e.name, `- ${e.name}: ${left.get(e.name)!.description.split("\n")[0]}`] as const);
}

/** What comes to mind about what the user said in session `id` (its `vector`), as a note the agent reads
 *  with its next step: the memories, earlier messages and tools close to it, not in its context; nothing
 *  if none is close. */
export async function recall(app: App, agent: number, id: number, vector: number[]): Promise<void> {
  const session = new Session(app, id), known = await session.known();
  const [mine, before, more] = await Promise.all([memories(app, agent, vector, known), said(app, agent, id, vector, known), tools(app, agent, vector, known)]);
  const lines = (list: readonly (readonly [string, string])[]) => list.map(([, line]) => line).join("\n");
  const note = [
    mine.length ? `## Possibly relevant memories\n${lines(mine)}` : "",
    before.length ? `## Said earlier in this session\n${lines(before)}` : "",
    more.length ? `## Possibly relevant tools\nNot in your tool list; call them with ${CALL}.\n${lines(more)}` : "",
  ].filter(Boolean).join("\n\n");
  if (note) await session.note(note, { known: [...mine, ...before, ...more].map(([key]) => key) });
}
