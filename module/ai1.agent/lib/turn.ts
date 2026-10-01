import { ApiError, errMsg, NotFoundError, toTools, unixTime } from "@qino/qino";
import { all, find } from "@qino/qino/ai1.discover";
import { run } from "@qino/qino/ai1.tools";

import * as memory from "./memory.ts";
import * as search from "./search.ts";

import type { ApiTree, App, Ctx, Method, Tool } from "@qino/qino";
import type { Message, Part, TextOutput } from "@qino/qino/ai1";

// One turn after the other per session, as a person answers: a message waits for the one before.
const queues = new WeakMap<App, Map<number, Promise<unknown>>>();
function inTurn<T>(app: App, session: number, fn: () => Promise<T>): Promise<T> {
  const queue = queues.get(app) ?? queues.set(app, new Map()).get(app)!;
  const turn = (queue.get(session) ?? Promise.resolve()).then(fn, fn);
  const done = () => { if (queue.get(session) === tail) queue.delete(session); };
  const tail = turn.then(done, done);
  queue.set(session, tail);
  return turn;
}

/** The api below each path (`cms`, `cms/node`) as tools. */
const toolsOf = (app: App, paths: string[]): Tool[] => paths.flatMap((path) => {
  const segments = path.split("/"), node = segments.reduce<unknown>((at, seg) => (at as ApiTree)?.[seg], app.apiTree);
  return node ? toTools(segments.reduceRight((below, seg) => ({ [seg]: below }), node) as ApiTree) : [];
});

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

/** Of the agent's tools, those closest to its role. */
async function closest(app: App, role: string, tools: Tool[]): Promise<Tool[]> {
  const names = new Set(tools.map((tool) => tool.name));
  const close = new Set(role ? (await find(app, "tools", role, all(app, "tools").filter((e) => names.has(e.name)), CLOSE).catch((e) => (log(e), []))).map((e) => e.name) : []);
  return tools.filter((tool) => close.has(tool.name));
}

// What every agent can do about itself: its memories and its search, with its own id set.
const OWN: Record<string, Method[]> = { "/:agent/memories": ["post"], "/:agent/memories/:memory": ["delete"], "/:agent/search": ["post"] };

/** The agent's own routes as tools, the agent param taken out and always its id. */
const ownTools = (app: App, agent: number): Tool[] =>
  toTools({ ":agent": (app.apiTree["ai1.agent"] as ApiTree).agents[":agent"] } as ApiTree, { apis: OWN }).map((tool) => {
    const { agent: _, ...properties } = (tool.parameters.properties ?? {}) as Record<string, unknown>;
    const required = (tool.parameters.required as string[]).filter((name) => name !== "agent");
    return { ...tool, parameters: { ...tool.parameters, properties, required }, execute: (args, ctx) => tool.execute({ ...args as object, agent }, ctx) };
  });

/** A stored `prefer`; empty or none is no choice of its own. */
const weights = (json: unknown): Record<string, number> | undefined => {
  const prefer = JSON.parse(String(json || "{}"));
  return Object.keys(prefer).length ? prefer : undefined;
};

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
  return inTurn(app, session, async () => {
    const agent = await app.db.row`SELECT s.usr_id, s.agent_id, s.prefer, a.prefer AS agent_prefer, a.system, a.tools FROM ai1_session s JOIN ai1_agent a ON a.id = s.agent_id WHERE s.id = ${session}`;
    if (!agent) throw new Error(`No session ${session}`);
    const kept = (await app.db.col`SELECT message FROM ai1_session_message WHERE session_id = ${session} ORDER BY id`).map((json) => JSON.parse(String(json)));
    const id = Number(agent.agent_id), asked: Message = { role: "user", content };
    // other modules add to what the model is given: texts to its context, tools
    const { parts, tools: more } = await app.fire("ai1.agent:turn", { agent: id, session, usrId: Number(agent.usr_id), parts: [] as string[], tools: [] as Tool[] });
    const allowed = toolsOf(app, JSON.parse(String(agent.tools || "[]"))), many = allowed.length > AT_ONCE;
    const always = [...ownTools(app, id), ...more], found = many ? finders(app, allowed) : [];
    const tools = [...always, ...allowed, ...found];
    const prefer = weights(agent.prefer) ?? weights(agent.agent_prefer); // the session's, else the agent's
    // given once, as the session starts: later changes come with the next session
    let given = kept.find(isGiven);
    if (!given) {
      const system = [agent.system, await memory.index(app, id), ...parts].filter(Boolean).join("\n\n");
      const offer = many ? [...always, ...await closest(app, String(agent.system ?? ""), allowed), ...found] : tools;
      await save(app, session, id, given = { role: "system" as const, content: system, tools: offer.map(({ name, description, parameters }) => ({ name, description, parameters })), prefer });
    }
    await save(app, session, id, asked);
    // the tools as given, run as they are now
    const now = new Map(tools.map((tool) => [tool.name, tool]));
    const offered = (given.tools as Omit<Tool, "execute">[]).map((tool) => ({ ...tool, execute: (args: unknown, ctx: Ctx) => now.get(tool.name)?.execute(args, ctx) ?? Promise.reject(new ApiError(404, `No longer available: ${tool.name}`)) }));
    return await run(app, {
      messages: [...given.content ? [{ role: "system" as const, content: given.content }] : [], ...kept.filter((m) => m.role !== "error" && !isGiven(m)), asked],
      tools: offered,
      usrId: Number(agent.usr_id),
      onText,
      onMessage: (message, modelProvider) => save(app, session, id, message, modelProvider), // each step, as it comes
    }, { prefer })
      .catch(async (e) => { throw (await save(app, session, id, { role: "error", content: errMsg(e) }), e); });
  });
}
