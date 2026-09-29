import { errMsg, sql } from "@qino/qino";
import { collection, index, search } from "@qino/qino/ai1.embed";
import { hit } from "@qino/qino/score";

import type { App } from "@qino/qino";
import type { Part } from "@qino/qino/ai1";

// What an agent keeps is findable by meaning: its memories and the messages of all its sessions.

/** The text of a message's content, without images. */
export const textOf = (content: string | Part[]): string =>
  typeof content === "string" ? content : content.flatMap((p) => p.type === "text" ? [p.text] : []).join("\n");

/** Only memories this close to what was said come to mind. */
const CLOSE = 0.75;

const log = (e: unknown) => console.error("[ai1.agent] embedding:", errMsg(e));

/** Make `text` findable, only where there is an embedding collection. Resolves to the vectors it
 *  embedded; never rejects. */
export async function keep(app: App, name: "ai1_agent_memory" | "ai1_session_message", key: Record<string, number>, text: string): Promise<number[][]> {
  return text && await collection(app) ? await index(app, name, key, text).catch((e) => (log(e), [])) : [];
}

/** Recalling by association: the memories close to what was just said grow stronger, the closer the
 *  more — with the vector the message got anyway. */
export async function associate(app: App, agent: number, vector: number[]): Promise<void> {
  const close = await search(app, { ai1_agent_memory: sql`e.agent_id = ${agent}` }, vector, { limit: 5 }).catch((e) => (log(e), []));
  for (const { key, score } of close) if (score >= CLOSE) hit(app.db, "ai1_agent_memory", Number(key.memory_id), score);
}

/** The agent's memories and the messages of all its sessions, with anyone, nearest to `query`. A
 *  memory found grows stronger, as recalling does: the closer, the more. */
export async function find(app: App, agent: number, query: string): Promise<Record<string, unknown>[]> {
  const mine = sql`e.agent_id = ${agent}`;
  const hits = await search(app, { ai1_agent_memory: mine, ai1_session_message: mine }, query, { limit: 10 });
  const said = new Map((await app.db.query`SELECT id, session_id, time FROM ai1_session_message
    WHERE ${sql.in("id", hits.flatMap((h) => h.key.message_id ?? []))}`).map((m) => [Number(m.id), m]));
  return hits.map(({ key, content, score }) => {
    if (key.memory_id) return score > 0 && hit(app.db, "ai1_agent_memory", Number(key.memory_id), score), { memory: key.memory_id, text: content };
    const message = said.get(Number(key.message_id));
    return { session: message?.session_id, time: message?.time, text: content };
  });
}
