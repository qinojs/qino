import { ApiError, errMsg, NotFoundError, toTools } from "@qino/qino";
import { all, find } from "@qino/qino/ai1.discover";

import * as memory from "./memory.ts";
import { isGiven, save } from "./record.ts";
import * as search from "./search.ts";

import type { ApiTree, App, Ctx, Method, Tool } from "@qino/qino";
import type { Message } from "@qino/qino/ai1";

// What the model is given: where it is, the agent's role and memories, its tools, the session so far.

/** Told to every agent first: where it is and how it exists. */
export const situation = (agent: number, session: number, url: string): string =>
  `You are agent ${agent} in Qino at ${url}, session ${session}; other sessions, with other users, share your memories. You act with this user's rights.`;

/** Does `entry` name the tool: by its name, or `prefix_*` for all below a path (`cms_*`, `cms_node_*`)? */
const names = (entry: string, name: string) => entry.endsWith("_*") ? name.startsWith(entry.slice(0, -1)) : name === entry;

/** The api's tools the entries name. */
const toolsOf = (app: App, entries: string[]) => toTools(app.apiTree).filter((tool) => entries.some((entry) => names(entry, tool.name)));

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

/** What the model is given in `session`, as for a turn: the role with memories and the tools as the
 *  session started with them (kept as its first message, of role `system`), run as they are now; the
 *  history after it, as other modules let it be sent (compaction); how the model is chosen. What was
 *  sent is never changed, only added to (prompt cache). */
export async function context(app: App, session: number) {
  const agent = await app.db.row`SELECT s.usr_id, s.agent_id, s.prefer, a.prefer AS agent_prefer, a.system, a.tools FROM ai1_session s JOIN ai1_agent a ON a.id = s.agent_id WHERE s.id = ${session}`;
  if (!agent) throw new Error(`No session ${session}`);
  const kept = (await app.db.query`SELECT id, message FROM ai1_session_message WHERE session_id = ${session} ORDER BY id`)
    .map((row) => ({ id: Number(row.id), message: JSON.parse(String(row.message)) }));
  const id = Number(agent.agent_id), usrId = Number(agent.usr_id);
  // other modules add to what the model is given: texts to its context, tools
  const { parts, tools: more } = await app.fire("ai1.agent:turn", { agent: id, session, usrId, parts: [] as string[], tools: [] as Tool[] });
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
  // the tools as given, run as they are now
  const now = new Map(tools.map((tool) => [tool.name, tool]));
  const offered = (given.tools as Omit<Tool, "execute">[]).map((tool) => ({ ...tool, execute: (args: unknown, ctx: Ctx) => now.get(tool.name)?.execute(args, ctx) ?? Promise.reject(new ApiError(404, `No longer available: ${tool.name}`)) }));
  const messages: Message[] = [...given.content ? [{ role: "system" as const, content: given.content }] : [], ...answered(history.map((row: { message: Message }) => row.message))];
  return { agent: id, usrId, prefer, tools: offered, messages };
}
