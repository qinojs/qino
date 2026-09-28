import { errMsg, unixTime } from "@qino/qino";
import { run } from "@qino/qino/ai1.tools";

import * as memory from "./memory.ts";
import * as search from "./search.ts";

import type { App, Tool } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai1";

// One turn after the other per session, as a person answers: a message waits for the one before.
const queues = new WeakMap<App, Map<number, Promise<unknown>>>();
function inTurn<T>(app: App, session: number, fn: () => Promise<T>): Promise<T> {
  const queue = queues.get(app) ?? queues.set(app, new Map()).get(app)!;
  const turn = (queue.get(session) ?? Promise.resolve()).then(fn, fn);
  const done = () => { if (queue.get(session) === turn) queue.delete(session); };
  queue.set(session, turn.then(done, done));
  return turn;
}

/** The tools of the named sets, as the linked modules declare them (`ai1Tools`). */
const toolsOf = (app: App, names: string[]): Tool[] =>
  names.flatMap((name) => app.modules.linked().flatMap((mod) => mod.plugin.ai1Tools?.[name]?.(app) ?? []));

/** Keep a message in the protocol; what was said is also made findable. */
async function save(app: App, session: number, agent: number, message: Message | { role: "error"; content: string }, model?: string) {
  const id = Number(await app.db.table("ai1_session_message").insert({ session_id: session, time: unixTime(), message: JSON.stringify(message), model }));
  if (message.role === "user" || message.role === "assistant") search.keep(app, "ai1_session_message", { agent_id: agent, message_id: id }, search.textOf(message.content));
}

/** Answer `content` in `session`, from its agent's role and memories, the session so far and the
 *  agent's tools, with the rights of the session's user. Everything is kept; a failure as a message
 *  of role `error`, which is not sent again. */
export function ask(app: App, session: number, content: string | Part[], { onText }: { onText?: (delta: string) => void } = {}): Promise<TextOutput & { messages: Message[] }> {
  return inTurn(app, session, async () => {
    const agent = await app.db.row`SELECT s.usr_id, s.agent_id, a.system, a.tools FROM ai1_session s JOIN ai1_agent a ON a.id = s.agent_id WHERE s.id = ${session}`;
    if (!agent) throw new Error(`No session ${session}`);
    const past = (await app.db.col`SELECT message FROM ai1_session_message WHERE session_id = ${session} ORDER BY id`)
      .map((json) => JSON.parse(String(json))).filter((message) => message.role !== "error");
    const id = Number(agent.agent_id), asked: Message = { role: "user", content };
    const system = [agent.system, await memory.index(app, id)].filter(Boolean).join("\n\n");
    await save(app, session, id, asked);
    const out = await run(app, {
      messages: [...system ? [{ role: "system" as const, content: system }] : [], ...past, asked],
      tools: [...memory.tools(app, id), search.tool(app, id), ...toolsOf(app, JSON.parse(String(agent.tools || "[]")))],
      usrId: Number(agent.usr_id),
      onText,
    }).catch(async (e) => { throw (await save(app, session, id, { role: "error", content: errMsg(e) }), e); });
    // the model named is the one that gave the last answer
    for (const [i, message] of out.messages.entries()) await save(app, session, id, message, i === out.messages.length - 1 ? out.model : undefined);
    return out;
  });
}
