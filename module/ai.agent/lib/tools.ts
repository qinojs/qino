import { ApiError, errMsg, NotFoundError, toTools } from "@qino/qino";
import { all, find } from "@qino/qino/ai.discover";

import * as search from "./search.ts";

import type { ApiTree, App, Method, Tool } from "@qino/qino";

// The tools an agent may use: those of its api paths, and its own. With many, it is given those closest
// to its role, and finds and calls the others.

/** Does `entry` name the tool: by its name, or `prefix_*` for all below a path (`cms_*`, `cms_node_*`)? */
const names = (entry: string, name: string) => entry.endsWith("_*") ? name.startsWith(entry.slice(0, -1)) : name === entry;

/** The api's tools the entries name. */
export const toolsOf = (app: App, entries: string[]) => toTools(app.apiTree).filter((tool) => entries.some((entry) => names(entry, tool.name)));

/** Refuses entries that name no tool, as a misspelt one would leave the agent without it. */
export function checkTools(app: App, entries: string[]): void {
  const all = toTools(app.apiTree), unknown = entries.filter((entry) => !all.some((tool) => names(entry, tool.name)));
  if (unknown.length) throw new ApiError(400, `No such tools: ${unknown.join(", ")} (a tool's name, or prefix_* for all below a path)`);
}

// The tools it is given stay the same while the start does (prompt cache).

/** More tools than this, and the agent finds them. */
export const AT_ONCE = 20;
/** How many of them it is given, the closest to its role. */
const CLOSE = 15;

const log = (e: unknown) => console.error("[ai.agent] tools:", errMsg(e));

/** Calls one of the agent's tools by name: one it found, not given. */
export const CALL = "call_tool";

/** A call as made: through `CALL`, the tool it called. */
export const called = <T extends { name: string; args?: unknown }>(call: T): T => call.name === CALL ? { ...call, ...call.args as object } : call;

/** To find the agent's tools and call them by name, only those. */
function finders(app: App, tools: Tool[]): Tool[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool])), among = all(app, "tools").filter((e) => byName.has(e.name));
  return [{
    name: "find_tools",
    description: `Find more of your tools by what they should do: name, description and parameters. Call them with ${CALL}.`,
    parameters: { type: "object", properties: { search: { type: "string", description: "Vector search: what the tool should do" } }, required: ["search"] },
    execute: async (args) => (await find(app, "tools", String((args as { search?: string }).search ?? ""), among)).map((e) => e.detail),
  }, {
    name: CALL,
    description: "Call one of your tools by name",
    parameters: { type: "object", properties: { name: { type: "string" }, args: { type: "object" } }, required: ["name"] },
    execute: (call, ctx) => {
      const { name, args = {} } = call as { name: string; args?: object };
      return byName.get(name)?.execute(args, ctx) ?? Promise.reject(new NotFoundError(`Not one of your tools: ${name}`));
    },
  }];
}

/** What the agent may use, as a session starts with it: its own tools, those of its api paths `allowed`
 *  and, with many, those to find the others. `ranked`: the ones of its api paths by nearness to its role
 *  (ai.discover), the nearest first, with how near (`score`, 1 the same); `given`: a session starts
 *  with it — all, or with many the nearest; `always`: no api path's, every session has it. */
export async function choice(app: App, agent: number, role: string, allowed: Tool[], ranked: boolean) {
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
  const row = await app.db.row`SELECT system, tools FROM ai_agent WHERE id = ${agent}`;
  if (!row) throw new NotFoundError("No such agent");
  return choice(app, agent, String(row.system ?? ""), toolsOf(app, JSON.parse(String(row.tools || "[]"))), true);
}

// What every agent can do about itself: its memories and its search, with its own id set.
const OWN: Record<string, Method[]> = { "/:agent/memories": ["post"], "/:agent/memories/:memory": ["delete"], "/:agent/search": ["post"] };

/** The agent's own routes as tools, the agent param taken out and always its id. */
const ownTools = (app: App, agent: number): Tool[] =>
  toTools({ ":agent": (app.apiTree["ai.agent"] as ApiTree).agent[":agent"] } as ApiTree, { apis: OWN }).map((tool) => {
    const { agent: _, ...properties } = (tool.parameters.properties ?? {}) as Record<string, unknown>;
    const required = (tool.parameters.required as string[]).filter((name) => name !== "agent");
    return { ...tool, parameters: { ...tool.parameters, properties, required }, execute: (args, ctx) => tool.execute({ ...args as object, agent }, ctx) };
  });
