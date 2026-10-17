import { sql } from "@qino/qino";
import { search } from "@qino/qino/ai.embed";
import { all, find } from "@qino/qino/ai.discover";
import { Agent, CALL, Session } from "@qino/qino/ai.agent";

import type { App } from "@qino/qino";

/** Only what is this close to what was said comes to mind. */
const CLOSE = 0.65; // todo? adjustable
/** Of memories and of tools at most this many, the nearest. */
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

/** The agent's tools close to `vector` and not in the context, by name: `- name: what it does`. */
async function tools(app: App, agent: number, vector: number[], known: Set<string>) {
  const left = new Map((await new Agent(app, agent).allowed()).filter((tool) => !known.has(tool.name)).map((tool) => [tool.name, tool]));
  if (!left.size) return [];
  const near = await find(app, "tools", vector, all(app, "tools").filter((e) => left.has(e.name)), MOST);
  return near.filter((e) => (e.score ?? 0) >= CLOSE).map((e) => [e.name, `- ${e.name}: ${left.get(e.name)!.description.split("\n")[0]}`] as const);
}

/** What comes to mind about what the user said in session `id` (its `vector`), as a note the agent reads
 *  with its next step: the memories and tools close to it, not in its context; nothing if none is close. */
export async function recall(app: App, agent: number, id: number, vector: number[]): Promise<void> {
  const session = new Session(app, id), known = await session.known();
  const [mine, more] = await Promise.all([memories(app, agent, vector, known), tools(app, agent, vector, known)]);
  const lines = (list: readonly (readonly [string, string])[]) => list.map(([, line]) => line).join("\n");
  const note = [
    mine.length ? `## Possibly relevant memories\n${lines(mine)}` : "",
    more.length ? `## Possibly relevant tools\nNot in your tool list; call them with ${CALL}.\n${lines(more)}` : "",
  ].filter(Boolean).join("\n\n");
  if (note) await session.note(note, { known: [...mine, ...more].map(([key]) => key) });
}
