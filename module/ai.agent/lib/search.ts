import { errMsg, sql, sqlSearch } from "@qino/qino";
import { collection, embedded, index, search } from "@qino/qino/ai.embed";
import { hit } from "@qino/qino/score";

import type { App } from "@qino/qino";
import type { Part } from "@qino/qino/ai";

// What an agent keeps is findable by meaning: its memories and the messages of all its sessions.

/** The text of a message's content, without images. */
export const textOf = (content: string | Part[]): string =>
  typeof content === "string" ? content : content.flatMap((p) => p.type === "text" ? [p.text] : []).join("\n");

/** Only memories this close to what was said come to mind. */
const CLOSE = 0.75;

const log = (e: unknown) => console.error("[ai.agent] embedding:", errMsg(e));

/** Make `text` findable, only where there is an embedding collection. Resolves to the vectors it
 *  embedded; never rejects. */
export async function keep(app: App, name: "ai_agent" | "ai_agent_memory" | "ai_session_message", key: Record<string, number>, text: string): Promise<number[][]> {
  return text && await collection(app) ? await index(app, name, key, text).catch((e) => (log(e), [])) : [];
}

/** Recalling by association: the memories close to what was just said grow stronger, the closer the
 *  more — with the vector the message got anyway. */
export async function associate(app: App, agent: number, vector: number[]): Promise<void> {
  const close = await search(app, { ai_agent_memory: sql`e.agent_id = ${agent}` }, vector, { limit: 5 }).catch((e) => (log(e), []));
  for (const { key, score } of close) if (score >= CLOSE) hit(app.db, "ai_agent_memory", Number(key.memory_id), score);
}

/** The agent's memories and the messages of all its sessions, with anyone, nearest to `query`. A
 *  memory found grows stronger, as recalling does: the closer, the more. */
export async function find(app: App, agent: number, query: string): Promise<Record<string, unknown>[]> {
  const mine = sql`e.agent_id = ${agent}`;
  const hits = await search(app, { ai_agent_memory: mine, ai_session_message: mine }, query, { limit: 10 });
  const said = new Map((await app.db.query`SELECT id, session_id, time FROM ai_session_message
    WHERE ${sql.in("id", hits.flatMap((h) => h.key.message_id ?? []))}`).map((m) => [Number(m.id), m]));
  return hits.map(({ key, content, score }) => {
    if (key.memory_id) return score > 0 && hit(app.db, "ai_agent_memory", Number(key.memory_id), score), { memory: key.memory_id, text: content };
    const message = said.get(Number(key.message_id));
    return { session: message?.session_id, time: message?.time, text: content };
  });
}

/** The agent's role as one vector, the mean of its chunks: embedded once, again only when it changed;
 *  none without an embedding collection or role. */
export async function role(app: App, agent: number, text: string): Promise<number[] | undefined> {
  await keep(app, "ai_agent", { agent_id: agent }, text);
  const chunks = await embedded(app, "ai_agent", { agent_id: agent }).catch((e) => (log(e), []));
  return chunks.length ? chunks[0].map((_, i) => chunks.reduce((sum, v) => sum + v[i], 0) / chunks.length) : undefined;
}

/** The agents, the latest first; with `query` those whose role is nearest to it by meaning (without an
 *  embedding collection: with most of its words). */
export async function agents(app: App, query?: string, limit = 10): Promise<{ id: number; role: string; score?: number }[]> {
  const db = app.db, first = (system: unknown) => String(system ?? "").split("\n")[0];
  if (!query) return (await db.query`SELECT id, system FROM ai_agent ORDER BY id DESC LIMIT ${limit}`).map((a) => ({ id: Number(a.id), role: first(a.system) }));
  if (!await collection(app)) {
    const { where, order } = sqlSearch(query, ["system"]);
    return (await db.query`SELECT id, system FROM ai_agent WHERE ${where} ORDER BY ${order} LIMIT ${limit}`).map((a) => ({ id: Number(a.id), role: first(a.system) }));
  }
  // the roles not embedded yet, before they are searched
  for (const a of await db.query`SELECT id, system FROM ai_agent WHERE id NOT IN (SELECT agent_id FROM embedding_ai_agent)`) {
    await keep(app, "ai_agent", { agent_id: Number(a.id) }, String(a.system ?? ""));
  }
  const best = new Map<number, number>();
  for (const { key, score } of await search(app, "ai_agent", query, { limit: limit * 3 })) {
    if (!best.has(Number(key.agent_id))) best.set(Number(key.agent_id), score); // its nearest chunk
  }
  const ids = [...best.keys()].slice(0, limit);
  const roles = new Map((await db.query`SELECT id, system FROM ai_agent WHERE ${sql.in("id", ids)}`).map((a) => [Number(a.id), first(a.system)]));
  return ids.flatMap((id) => roles.has(id) ? [{ id, role: roles.get(id)!, score: best.get(id) }] : []);
}
