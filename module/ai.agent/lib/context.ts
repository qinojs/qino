import { ApiError } from "@qino/qino";

import * as memory from "./memory.ts";
import { save } from "./record.ts";
import { AT_ONCE, choice, toolsOf } from "./tools.ts";

import type { App, Ctx, Tool } from "@qino/qino";
import type { Message } from "@qino/qino/ai";

// What the model is given: where it is, the agent's role and memories, its tools, the session so far.

/** Told to every agent first: where it is and how it exists. */
export const situation = (agent: number, session: number, url: string): string =>
  `You are agent ${agent} in Qino at ${url}, session ${session}; other sessions, with other users, share your memories. You act with this user's rights.`;

/** A stored `prefer`; empty or none is no choice of its own. */
const weights = (json: unknown): Record<string, number> | undefined => {
  const prefer = JSON.parse(String(json || "{}"));
  return Object.keys(prefer).length ? prefer : undefined;
};

/** Every tool call answered: a turn that failed amid its calls left some without a result, which no
 *  provider takes. Added the same way each time, so what is sent stays the same (prompt cache). */
function answered(messages: Message[]) {
  return messages.flatMap((m, i) => {
    if (m.role !== "assistant" || !m.toolCalls?.length) return [m];
    const after = messages.slice(i + 1), end = after.findIndex((next) => next.role !== "tool");
    const ids = new Set(after.slice(0, end < 0 ? after.length : end).map((next) => (next as { id: string }).id));
    // before the results there are: those of one step stay together
    return [m, ...m.toolCalls.filter((call) => !ids.has(call.id))
      .map((call) => ({ role: "tool" as const, id: call.id, content: '{"error":"No result: the turn failed"}' }))];
  });
}

/** What the model of `session` was given at its latest start (none before its first question), and the
 *  history, as other modules let it be sent (compaction); what is kept stays. */
async function sent(app: App, agent: number, session: number) {
  const kept = (await app.db.query`SELECT id, message FROM ai_session_message WHERE session_id = ${session} ORDER BY id`)
    .map((row) => ({ id: Number(row.id), message: JSON.parse(String(row.message)) }));
  const { history } = await app.fire("ai.agent:history", { agent, session, history: kept.filter((row) => row.message.role !== "error" && row.message.role !== "start") });
  const start = kept.findLast((row) => row.message.role === "start"), rows = history as { id: number; message: Message & { known?: string[] } }[];
  return { start, history: rows };
}

const agentOf = async (app: App, session: number) => Number(await app.db.one`SELECT agent_id FROM ai_session WHERE id = ${session}`);

/** What the model of `session` has in its context, by key: the kept messages still sent (`#7`), its tools
 *  as given and what the messages list as `known` (memories by id, `5`; others' by theirs, `u5`; tools by name). */
export async function known(app: App, session: number): Promise<Set<string>> {
  const { start, history } = await sent(app, await agentOf(app, session), session);
  return new Set([...start ? [start, ...history] : history].flatMap((row) =>
    [`#${row.id}`, ...row.message.tools?.map((tool: Tool) => tool.name) ?? [], ...row.message.known ?? []]));
}

/** What the model is given in `session`, as for a turn: the role with memories and the tools as of its
 *  latest start (kept as a message of role `start`), run as they are now; the history, as other modules
 *  let it be sent (compaction); how the model is chosen. What was sent stays the same while the provider's
 *  cache holds it (prompt cache): the start is renewed only once the history was cut (compaction) or
 *  with `renew` (after a pause longer than the cache keeps it), and kept only with `keep` (a turn):
 *  reading it changes nothing. */
export async function context(app: App, session: number, { renew = false, keep = false } = {}) {
  const row = await app.db.row`SELECT s.usr_id, s.agent_id, s.prefer, a.prefer AS agent_prefer, a.system, a.tools
    FROM ai_session s JOIN ai_agent a ON a.id = s.agent_id WHERE s.id = ${session}`;
  if (!row) throw new Error(`No session ${session}`);
  const agent = Number(row.agent_id), usrId = Number(row.usr_id);
  // other modules add to what the model is given: texts to its context (with their keys), tools
  const { parts, known, tools: added } = await app.fire("ai.agent:turn", {
    agent, session, usrId, parts: [] as string[], known: [] as string[], tools: [] as Tool[],
  });
  const prefer = weights(row.prefer) ?? weights(row.agent_prefer); // the session's, else the agent's
  const { start, history } = await sent(app, agent, session);
  // a start is saved after the question it answers: history newer than it came after a cut
  const fresh = renew || !start || (history[0]?.id ?? 0) > start.id;
  const allowed = toolsOf(app, JSON.parse(String(row.tools || "[]")));
  // ranked only when it starts
  const chosen = await choice(app, agent, String(row.system ?? ""), allowed, fresh && allowed.length > AT_ONCE);
  let given = start?.message;
  if (fresh) {
    const role = row.system ? `## Your role\n${row.system}` : "";
    const system = [situation(agent, session, await app.url()), role, await memory.index(app, agent), ...parts].filter(Boolean).join("\n\n");
    const offer = [...added, ...chosen.filter((c) => c.given).map((c) => c.tool)];
    const memories = (await memory.list(app, agent, memory.IN_MIND)).map((m) => String(m.id));
    given = {
      role: "start" as const, content: system, tools: offer.map(({ name, description, parameters }) => ({ name, description, parameters })),
      known: [...memories, ...known], prefer,
    };
    if (keep) await save(app, session, agent, given);
  }
  // the tools as given, run as they are now
  const now = new Map([...added, ...chosen.map((c) => c.tool)].map((tool) => [tool.name, tool]));
  const tools = (given.tools as Omit<Tool, "execute">[]).map((tool) => ({
    ...tool,
    execute: (args: unknown, ctx: Ctx) => now.get(tool.name)?.execute(args, ctx) ?? Promise.reject(new ApiError(404, `No longer available: ${tool.name}`)),
  }));
  const messages: Message[] = [
    ...given.content ? [{ role: "system" as const, content: given.content }] : [],
    ...answered(history.map((row: { message: Message }) => row.message)),
  ];
  return { agent, usrId, prefer, tools, messages };
}
