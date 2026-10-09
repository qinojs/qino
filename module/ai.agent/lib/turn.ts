import { errMsg } from "@qino/qino";
import { run } from "@qino/qino/ai.tools";

import { context } from "./context.ts";
import { save } from "./record.ts";

import type { App } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai";

/** A turn runs this long at most, then it is cancelled: a stream that never ends must not keep the session. */
const TURN_MS = 60 * 60_000;
/** Model calls per turn at most: a big task takes many steps, the time bounds it. */
const STEPS = 100;

// One turn after the other per session, as a person answers: a message waits for the one before.
const queues = new WeakMap<App, Map<number, Promise<unknown>>>();
const aborts = new WeakMap<App, Map<number, AbortController>>();
function inTurn<T>(app: App, session: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const queue = queues.get(app) ?? queues.set(app, new Map()).get(app)!;
  const now = aborts.get(app) ?? aborts.set(app, new Map()).get(app)!;
  const start = () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error(`Cancelled after ${TURN_MS / 60_000} minutes`)), TURN_MS);
    now.set(session, abort);
    // cancelled, the session is free at once, even if something below ignores the signal
    const stopped = new Promise<never>((_, reject) => abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true }));
    return Promise.race([fn(abort.signal), stopped]).finally(() => {
      clearTimeout(timer);
      if (now.get(session) === abort) now.delete(session);
    });
  };
  const turn = (queue.get(session) ?? Promise.resolve()).then(start, start);
  const done = () => { if (queue.get(session) === tail) queue.delete(session); };
  const tail = turn.then(done, done);
  queue.set(session, tail);
  return turn;
}

/** Whether a turn is on its way in `session`, or waiting for one. */
export const running = (app: App, session: number): boolean => !!queues.get(app)?.has(session);

/** Cancel the turn running in `session`; the one waiting next goes on. Whether one ran. */
export function cancel(app: App, session: number): boolean {
  const abort = aborts.get(app)?.get(session);
  abort?.abort(new Error("Cancelled"));
  return !!abort;
}

/** A note in `session`, kept in the history. The agent reads it with the next question (the model
 *  gets it as a `system` message in the history). */
export function note(app: App, session: number, content: string | Part[]): Promise<void> {
  return inTurn(app, session, async () => {
    const agent = await app.db.one`SELECT agent_id FROM ai_session WHERE id = ${session}`;
    if (!agent) throw new Error(`No session ${session}`);
    await save(app, session, Number(agent), { role: "system", content });
  });
}

/** Answer `content` in `session`, from its agent's role and memories, the session so far and the
 *  agent's tools (`context`), with the rights of the session's user. Everything is kept: a failure as a
 *  message of role `error`, not sent again. */
export function ask(app: App, session: number, content: string | Part[], { onText }: { onText?: (delta: string) => void } = {}): Promise<TextOutput & { messages: Message[] }> {
  return inTurn(app, session, async (signal) => {
    const { agent: id, usrId, prefer, tools, messages: given } = await context(app, session);
    const asked: Message = { role: "user", content }, messages = [...given, asked];
    await save(app, session, id, asked);
    // always streamed: a long answer is no silence, and what a cancelled step said so far stays
    let partial = "";
    const out = await run(app, {
      messages,
      tools,
      usrId,
      onText: (delta) => { partial += delta; onText?.(delta); },
      maxSteps: STEPS,
      onMessage: (message, modelProvider) => (partial = "", save(app, session, id, message, modelProvider)), // each step, as it comes
    }, { prefer, signal })
      .catch(async (e) => {
        if (partial) await save(app, session, id, { role: "assistant", content: `${partial}\n\n(interrupted)` });
        throw (await save(app, session, id, { role: "error", content: errMsg(e) }), e);
      });
    // in the background: all the model was given and answered, as it was sent (e.g. to compact it)
    const { model, modelProvider } = out;
    app.fire("ai.agent:answered", { agent: id, session, usrId, messages: [...messages, ...out.messages], tools, model, modelProvider, prefer })
      .catch((e) => console.error("[ai.agent] answered:", errMsg(e)));
    return out;
  });
}
