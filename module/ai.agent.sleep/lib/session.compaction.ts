import { ApiError, errMsg, unixTime } from "@qino/qino";
import { run } from "@qino/qino/ai1.tools";

import type { App, Tool } from "@qino/qino";
import type { Message } from "@qino/qino/ai1";

// A session grown past most of its model's context is compacted after an answer, in the background:
// the agent first keeps what lasts (`remember`), then writes a handoff for itself. From then on that
// summary and the last turns are sent instead of what came before. The record stays as it is.

/** Compacted from this share of the model's context on. */
export const AT = 0.8;
/** Turns kept word for word, at most; fewer while they alone fill more than `TAIL` of the context. */
export const TURNS = 4;
const TAIL = 0.4;
/** The only tool that runs while compacting: the agent's own `remember`. */
const REMEMBER = "memories_post";

/** Told to the agent at the end of what it was given, so the prompt cache holds. */
export const PROMPT = (turns: number): string =>
  `Your context is about to be compacted: what came before the last ${turns} user turns will be replaced by what you write now; those turns stay word for word.\n` +
  `1. First keep with \`${REMEMBER}\` what lasts beyond this session: rules and preferences the user gave, also casual ones, unless your memories hold them.\n` +
  "2. Then answer with a handoff for yourself to go on with this session:\n" +
  "- the user's goal and every instruction or constraint they gave for this session, in their words\n" +
  "- decisions made and why; errors and how they were fixed\n" +
  "- what was done, with ids, urls and names; what is open; the next step\n" +
  "Leave out what your memories hold and what the kept turns show. Call no other tool.";

type Row = { id: number; message: Message & { summary?: { from: number } } };

/** A rough size in tokens, as ai1 estimates it. */
const size = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

// The compaction running per session; it resolves to the summary it kept.
const running = new WeakMap<App, Map<number, Promise<Row | undefined>>>();
// The sessions to compact after their next answer, however long.
const scheduled = new WeakMap<App, Set<number>>();

/** Compacts `session` after its current or next answer, however long it is. */
export function schedule(app: App, session: number): void {
  (scheduled.get(app) ?? scheduled.set(app, new Set()).get(app)!).add(session);
}

/** What is sent of `history`: the latest summary, then what was said from its `from` on. A
 *  compaction still running is waited for. */
export async function compacted(app: App, session: number, history: Row[]): Promise<Row[]> {
  return from(history, await running.get(app)?.get(session));
}

const from = (history: Row[], summary = history.findLast((row) => row.message.summary)) =>
  summary ? [{ id: summary.id, message: { role: "system" as const, content: summary.message.content } }, // sent without its mark
    ...history.filter((row) => row.id >= summary.message.summary!.from && !row.message.summary)] : history;

/** After an answer: compacts the session in the background once what was sent fills `AT` of the
 *  model's context, or when scheduled; with the same model, messages and tools (prompt cache). */
export async function compact(app: App, { session, usrId, messages, tools, model, modelProvider, prefer }: {
  session: number; usrId: number; messages: Message[]; tools: Tool[]; model: string; modelProvider: number; prefer?: Record<string, number>;
}): Promise<void> {
  const sessions = running.get(app) ?? running.set(app, new Map()).get(app)!;
  if (sessions.has(session)) return;
  const wanted = scheduled.get(app)?.delete(session);
  const job = (async () => {
    const limit = Number(await app.db.one`SELECT m.context_length FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id WHERE mp.id = ${modelProvider}`);
    if (!wanted && (!limit || size({ messages, tools }) < AT * limit)) return;
    // what is sent now, and of it the last turns to keep: at least one turn before them to summarize
    const kept = (await app.db.query`SELECT id, message FROM ai1_session_message WHERE session_id = ${session} ORDER BY id`)
      .map((row) => ({ id: Number(row.id), message: JSON.parse(String(row.message)) }));
    const sent = from(kept), asked = sent.filter((row) => row.message.role === "user");
    let turns = Math.min(TURNS, asked.length - 1);
    const tail = () => sent.filter((row) => row.id >= asked[asked.length - turns].id).map((row) => row.message);
    while (turns > 1 && limit && size(tail()) > TAIL * limit) turns--;
    if (turns < 1) return;
    const only = tools.map((tool) => tool.name === REMEMBER ? tool : { ...tool, execute: () => Promise.reject(new ApiError(409, "Not while compacting")) });
    const { text } = await run(app, { messages: [...messages, { role: "system", content: PROMPT(turns) }], tools: only, usrId }, { prefer, model, modelProvider });
    if (!text.trim()) return;
    const message = { role: "system" as const, content: `Summary of this session before the last turns:\n${text}`, summary: { from: asked[asked.length - turns].id } };
    const id = Number(await app.db.table("ai1_session_message").insert({ session_id: session, time: unixTime(), message: JSON.stringify(message) }));
    return { id, message };
  })().catch((e) => (console.error("[ai1.agent.sleep] compaction:", errMsg(e)), undefined));
  sessions.set(session, job);
  await job.finally(() => sessions.delete(session));
}
