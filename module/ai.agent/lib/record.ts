import { errMsg, unixTime } from "@qino/qino";

import * as search from "./search.ts";

import type { App } from "@qino/qino";
import type { Message, Part } from "@qino/qino/ai";

// The session's record: every message kept exactly, as it was said or sent.

/** What the model was given as the session started (the notes have no tools). */
export const isGiven = (m: { role: string; tools?: unknown }) => m.role === "system" && !!m.tools;

/** Keep a message in the protocol. In the background, what was said is made findable, and what the
 *  user says strengthens the memories close to it, with the same vector (`ai.agent:associate`). */
export async function save(
  app: App,
  session: number,
  agent: number,
  message: Message | { role: "error" | "system"; content: string | Part[]; [more: string]: unknown },
  modelProvider?: number,
) {
  const id = Number(await app.db.table("ai_session_message").insert({
    session_id: session,
    time: unixTime(),
    message: JSON.stringify(message),
    ...modelProvider && { model_provider_id: modelProvider },
  }));
  if (message.role !== "user" && message.role !== "assistant") return;
  search.keep(app, "ai_session_message", { agent_id: agent, message_id: id }, search.textOf(message.content))
    .then(async ([vector]) => {
      if (message.role !== "user" || !vector) return;
      await search.associate(app, agent, vector);
      await app.fire("ai.agent:associate", { agent, session, vector });
    })
    .catch((e) => console.error("[ai.agent] associate:", errMsg(e)));
}

