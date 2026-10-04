import { ApiError, errMsg, NotFoundError, toTools, unixTime } from "@qino/qino";
import { all, find } from "@qino/qino/ai1.discover";
import { run } from "@qino/qino/ai1.tools";

import * as memory from "./memory.ts";
import * as search from "./search.ts";

import type { ApiTree, App, Ctx, Method, Tool } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai1";

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

/** Told to every agent first: where it is and how it exists. */
export const situation = (agent: number, session: number, url: string): string =>
  `You are agent ${agent} in Qino at ${url}, session ${session}; other sessions, with other users, share your memories. You act with this user's rights.`;

/** Does `entry` name the tool: by its name, or `prefix_*` for all below a path (`cms_*`, `cms_node_*`)? */
const names = (entry: string, name: string) => entry.endsWith("_*") ? name.startsWith(entry.slice(0, -1)) : name === entry;

/** The api's tools the entries name. */
const toolsOf = (app: App, entries: string[]): Tool[] => toTools(app.apiTree).filter((tool) => entries.some((entry) => names(entry, tool.name)));

/** Refuses entries that name no tool, as a misspelt one would leave the agent without it. */
export function checkTools(app: App, entries: string[]): void {
  const all = toTools(app.apiTree), unknown = entries.filter((entry) => !all.some((tool) => names(entry, tool.name)));
  if (unknown.length) throw new ApiError(400, `No such tools: ${unknown.join(", ")} (a tool's name, or prefix_* for all below a path)`);
}

// With many tools, the agent is given those closest to its role, and finds and calls the others: the
// tools it is given stay the same all session long (prompt cache).

/** More tools than this, and the agent finds them. */
const AT_ONCE = 20;
/** How many of them it is given, the closest to its role. */
const CLOSE = 15;

const log = (e: unknown) => console.error("[ai1.agent] tools:", errMsg(e));

/** To find the agent's tools and call them by name (core's tool-calls), only those. */
function finders(app: App, tools: Tool[]): Tool[] {
  const names = new Set(tools.map((tool) => tool.name)), among = all(app, "tools").filter((e) => names.has(e.name));
  const [calls] = toTools(app.apiTree, { apis: { "/core/tool-calls": ["post"] } });
  return [{
    name: "find_tools",
    description: `Find more of your tools by what they should do: name, description and parameters. Call them with ${calls.name}.`,
    parameters: { type: "object", properties: { search: { type: "string", description: "What the tool should do" } }, required: ["search"] },
    execute: async (args) => (await find(app, "tools", String((args as { search?: string }).search ?? ""), among)).map((e) => e.detail),
  }, {
    ...calls,
    execute: (args, ctx) => {
      const other = ((args as { calls?: { name?: string }[] }).calls ?? []).find((call) => !names.has(String(call?.name)));
      return other ? Promise.reject(new NotFoundError(`Not one of your tools: ${other.name}`)) : calls.execute(args, ctx);
    },
  }];
}

/** What the agent may use, as a session starts with it: its own tools, those of its api paths `allowed`
 *  and, with many, those to find the others. `ranked`: the ones of its api paths by nearness to its role
 *  (ai1.discover), the nearest first, with how near (`score`, 1 the same); `given`: a session starts
 *  with it — all, or with many the nearest; `always`: no api path's, every session has it. */
async function choice(app: App, agent: number, role: string, allowed: Tool[], ranked: boolean) {
  const many = allowed.length > AT_ONCE, names = new Set(allowed.map((tool) => tool.name));
  // the role's vector as kept, else (no collection) its words
  const query = ranked && role ? await search.role(app, agent, role) ?? role : undefined;
  const near = query ? await find(app, "tools", query, all(app, "tools").filter((e) => names.has(e.name)), allowed.length).catch((e) => (log(e), [])) : [];
  const at = new Map(near.map((e, i) => [e.name, i])), place = (name: string) => at.get(name) ?? allowed.length;
  const always = (tools: Tool[]) => tools.map((tool) => ({ tool, given: true, always: true }));
  return [
    ...always(ownTools(app, agent)),
    ...allowed.map((tool) => ({ tool, score: near[at.get(tool.name) ?? -1]?.score, given: !many || place(tool.name) < CLOSE, always: false }))
      .sort((a, b) => place(a.tool.name) - place(b.tool.name)),
    ...always(many ? finders(app, allowed) : []),
  ];
}

/** What agent `agent` may use, as a session starts with it (`choice`), its api paths' tools ranked. */
export async function ranked(app: App, agent: number): Promise<{ tool: Tool; score?: number; given: boolean; always: boolean }[]> {
  const row = await app.db.row`SELECT system, tools FROM ai1_agent WHERE id = ${agent}`;
  if (!row) throw new NotFoundError("No such agent");
  return choice(app, agent, String(row.system ?? ""), toolsOf(app, JSON.parse(String(row.tools || "[]"))), true);
}

// What every agent can do about itself: its memories and its search, with its own id set.
const OWN: Record<string, Method[]> = { "/:agent/memories": ["post"], "/:agent/memories/:memory": ["delete"], "/:agent/search": ["post"] };

/** The agent's own routes as tools, the agent param taken out and always its id. */
const ownTools = (app: App, agent: number): Tool[] =>
  toTools({ ":agent": (app.apiTree["ai1.agent"] as ApiTree).agent[":agent"] } as ApiTree, { apis: OWN }).map((tool) => {
    const { agent: _, ...properties } = (tool.parameters.properties ?? {}) as Record<string, unknown>;
    const required = (tool.parameters.required as string[]).filter((name) => name !== "agent");
    return { ...tool, parameters: { ...tool.parameters, properties, required }, execute: (args, ctx) => tool.execute({ ...args as object, agent }, ctx) };
  });

/** A stored `prefer`; empty or none is no choice of its own. */
const weights = (json: unknown): Record<string, number> | undefined => {
  const prefer = JSON.parse(String(json || "{}"));
  return Object.keys(prefer).length ? prefer : undefined;
};

/** Every tool call answered: a turn that failed amid its calls left some without a result, which no
 *  provider takes. Added the same way each time, so what is sent stays the same (prompt cache). */
function answered(messages: Message[]): Message[] {
  return messages.flatMap((m, i) => {
    if (m.role !== "assistant" || !m.toolCalls?.length) return [m];
    const after = messages.slice(i + 1), end = after.findIndex((next) => next.role !== "tool");
    const ids = new Set(after.slice(0, end < 0 ? after.length : end).map((next) => (next as { id: string }).id));
    // before the results there are: those of one step stay together
    return [m, ...m.toolCalls.filter((call) => !ids.has(call.id))
      .map((call) => ({ role: "tool" as const, id: call.id, content: '{"error":"No result: the turn failed"}' }))];
  });
}

/** What the model was given as the session started (the notes have no tools). */
const isGiven = (m: { role: string; tools?: unknown }) => m.role === "system" && !!m.tools;

/** Keep a message in the protocol. In the background, what was said is made findable, and what the
 *  user says strengthens the memories close to it, with the same vector (`ai1.agent:associate`). */
async function save(
  app: App,
  session: number,
  agent: number,
  message: Message | { role: "error" | "system"; content: string | Part[]; [more: string]: unknown },
  modelProvider?: number,
) {
  const id = Number(await app.db.table("ai1_session_message").insert({
    session_id: session,
    time: unixTime(),
    message: JSON.stringify(message),
    ...modelProvider && { model_provider_id: modelProvider },
  }));
  if (message.role !== "user" && message.role !== "assistant") return;
  search.keep(app, "ai1_session_message", { agent_id: agent, message_id: id }, search.textOf(message.content))
    .then(async ([vector]) => {
      if (message.role !== "user" || !vector) return;
      await search.associate(app, agent, vector);
      await app.fire("ai1.agent:associate", { agent, session, vector });
    })
    .catch((e) => console.error("[ai1.agent] associate:", errMsg(e)));
}

/** A note in `session`, kept in the history. The agent reads it with the next question (the model
 *  gets it as a `system` message in the history). */
export function note(app: App, session: number, content: string | Part[]): Promise<void> {
  return inTurn(app, session, async () => {
    const agent = await app.db.one`SELECT agent_id FROM ai1_session WHERE id = ${session}`;
    if (!agent) throw new Error(`No session ${session}`);
    await save(app, session, Number(agent), { role: "system", content });
  });
}

/** Answer `content` in `session`, from its agent's role and memories, the session so far and the
 *  agent's tools, with the rights of the session's user. Everything is kept: what the model is given
 *  (role with memories, tools, prefer) as the first message, of role `system`; a failure as one of
 *  role `error`, not sent again. What was sent is never changed, only added to (prompt cache). */
export function ask(app: App, session: number, content: string | Part[], { onText }: { onText?: (delta: string) => void } = {}): Promise<TextOutput & { messages: Message[] }> {
  return inTurn(app, session, async (signal) => {
    const agent = await app.db.row`SELECT s.usr_id, s.agent_id, s.prefer, a.prefer AS agent_prefer, a.system, a.tools FROM ai1_session s JOIN ai1_agent a ON a.id = s.agent_id WHERE s.id = ${session}`;
    if (!agent) throw new Error(`No session ${session}`);
    const kept = (await app.db.query`SELECT id, message FROM ai1_session_message WHERE session_id = ${session} ORDER BY id`)
      .map((row) => ({ id: Number(row.id), message: JSON.parse(String(row.message)) }));
    const id = Number(agent.agent_id), asked: Message = { role: "user", content };
    // other modules add to what the model is given: texts to its context, tools
    const { parts, tools: more } = await app.fire("ai1.agent:turn", { agent: id, session, usrId: Number(agent.usr_id), parts: [] as string[], tools: [] as Tool[] });
    const prefer = weights(agent.prefer) ?? weights(agent.agent_prefer); // the session's, else the agent's
    // given once, as the session starts: later changes come with the next session; ranked only then, and with many
    let given = kept.map((row) => row.message).find(isGiven);
    const allowed = toolsOf(app, JSON.parse(String(agent.tools || "[]")));
    const list = await choice(app, id, String(agent.system ?? ""), allowed, !given && allowed.length > AT_ONCE);
    const tools = [...more, ...list.map((r) => r.tool)];
    if (!given) {
      const role = agent.system ? `## Your role\n${agent.system}` : "";
      const system = [situation(id, session, await app.url()), role, await memory.index(app, id), ...parts].filter(Boolean).join("\n\n");
      const offer = [...more, ...list.filter((r) => r.given).map((r) => r.tool)];
      await save(app, session, id, given = { role: "system" as const, content: system, tools: offer.map(({ name, description, parameters }) => ({ name, description, parameters })), prefer });
    }
    // other modules may send less of the history than was said (compaction); what is kept stays
    const { history } = await app.fire("ai1.agent:history", { agent: id, session, history: kept.filter((row) => row.message.role !== "error" && !isGiven(row.message)) });
    await save(app, session, id, asked);
    // the tools as given, run as they are now
    const now = new Map(tools.map((tool) => [tool.name, tool]));
    const offered = (given.tools as Omit<Tool, "execute">[]).map((tool) => ({ ...tool, execute: (args: unknown, ctx: Ctx) => now.get(tool.name)?.execute(args, ctx) ?? Promise.reject(new ApiError(404, `No longer available: ${tool.name}`)) }));
    const messages: Message[] = [...given.content ? [{ role: "system" as const, content: given.content }] : [], ...answered(history.map((row: { message: Message }) => row.message)), asked];
    const usrId = Number(agent.usr_id);
    // always streamed: a long answer is no silence, and what a cancelled step said so far stays
    let partial = "";
    const out = await run(app, {
      messages,
      tools: offered,
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
    app.fire("ai1.agent:answered", { agent: id, session, usrId, messages: [...messages, ...out.messages], tools: offered, model, modelProvider, prefer })
      .catch((e) => console.error("[ai1.agent] answered:", errMsg(e)));
    return out;
  });
}
