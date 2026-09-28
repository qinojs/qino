import { errMsg, sql } from "@qino/qino";
import { collection, index, search } from "@qino/qino/ai1.embed";
import { hit } from "@qino/qino/score";

import type { App, Tool } from "@qino/qino";
import type { Part } from "@qino/qino/ai1";

// What an agent keeps is findable by meaning: its memories and the messages of all its sessions.

/** The text of a message's content, without images. */
export const textOf = (content: string | Part[]): string =>
  typeof content === "string" ? content : content.flatMap((p) => p.type === "text" ? [p.text] : []).join("\n");

/** Make `text` findable, in the background and only where there is an embedding collection. */
export function keep(app: App, name: "ai1_agent_memory" | "ai1_session_message", key: Record<string, number>, text: string): void {
  if (!text) return;
  collection(app).then((c) => c && index(app, name, key, text)).catch((e) => console.error("[ai1.agent] embedding:", errMsg(e)));
}

/** search: every agent has it. A memory it finds grows stronger, as recalling does: the closer, the more. */
export const tool = (app: App, agent: number): Tool => ({
  name: "search",
  description: "Search your memories and all your past sessions, with anyone, by meaning.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  execute: async (args) => {
    const mine = sql`e.agent_id = ${agent}`;
    const hits = await search(app, { ai1_agent_memory: mine, ai1_session_message: mine }, String((args as { query: string }).query), { limit: 10 });
    const said = new Map((await app.db.query`SELECT id, session_id, time FROM ai1_session_message
      WHERE ${sql.in("id", hits.flatMap((h) => h.key.message_id ?? []))}`).map((m) => [Number(m.id), m]));
    return hits.map(({ key, content, score }) => {
      if (key.memory_id) return score > 0 && hit(app.db, "ai1_agent_memory", Number(key.memory_id), score), { memory: key.memory_id, text: content };
      const message = said.get(Number(key.message_id));
      return { session: message?.session_id, time: message?.time, text: content };
    });
  },
});
