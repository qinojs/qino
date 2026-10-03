// deno-lint-ignore-file no-explicit-any
import { getCtx, requestStorage, runAs, toTools } from "@qino/qino";
import { Sandbox } from "@qino/qino/sandbox";

import { hosts } from "./lib/hosts.ts";

export { history } from "./lib/history.ts";
export { hosts } from "./lib/hosts.ts";
export { toFlow } from "./lib/row.ts";

import type { App, Ctx, Tool } from "@qino/qino";

type Context = { user?: number };
type Call = { tool: string; args: unknown; result?: unknown; skipped?: true };
type Caps = { tools: any; context: Context; owner: number };
type Step =
  | { description: string; fn: string | ((value: any, caps: Caps) => unknown) }
  | { description: string; debounce: { ms: number; by?: string } };
type Trace = {
  flow: string;
  context: Context;
  steps: { description: string; value?: unknown; error?: string; calls: Call[] }[];
  end: "done" | "stopped" | "superseded" | "error";
};

/** A flow: when the event fires on the host, its steps run one after the other. */
export type Flow = {
  description: string;
  on: { host: string; event: string }; // the app or one of its emitters ("app", "db"), and its event
  owner: number; // tools run with this user's rights
  tools?: string[]; // the tools it may call, by name
  test?: boolean; // unless false: only `*_get` tools take effect, the other calls are recorded
  steps: Step[];
};

/** One sandbox, shared by the runs of a flow; tool calls name their run. Ended, it closes with its last run. */
type Box = { sandbox: Sandbox; runs: Map<number, (name: string, args: unknown) => unknown>; seq: number; ended?: true };

const open = (): Box => {
  const runs: Box["runs"] = new Map();
  const tool = (run: number, name: string, args: unknown) => runs.get(run)!(name, args);
  return { runs, seq: 0, sandbox: new Sandbox({ capabilities: { tool } }) };
};

/** No new runs; the running ones end with the version they began with. */
const end = (box: Box) => (box.ended = true, box.runs.size || box.sandbox.close());

const waiting = new WeakMap<Flow, Map<string, object>>(); // debounce: the latest run per key

/** Runs the flow whenever its event fires, until `signal` aborts; each trace goes to `report`.
 *  Events its own runs cause are ignored. */
export function listen(
  app: App,
  flow: Flow,
  { signal, report }: { signal?: AbortSignal; report?: (trace: Trace) => void } = {},
): void {
  const host = hosts(app)[flow.on.host];
  if (!host) throw new Error(`sandbox.flow: no host ${flow.on.host}`);
  const box = open();
  signal?.addEventListener("abort", () => end(box), { once: true });
  host.on(flow.on.event, (e: unknown) => {
    const ctx = requestStorage.getStore();
    if (ctx?.state.flow === flow) return;
    // in the background: the emitter never waits for a flow
    exec(app, flow, view(e), { user: ctx?.userId || undefined }, box).then(report, console.error);
  }, { signal });
}

/** Runs the flow once, e.g. to try it on an example event. */
export async function run(app: App, flow: Flow, event: unknown, context: Context = {}): Promise<Trace> {
  const box = open();
  try {
    return await exec(app, flow, event, context, box);
  } finally {
    end(box);
  }
}

/** Each step's result is the next one's input: a falsy result stops, `true` passes the input on. */
async function exec(app: App, flow: Flow, event: unknown, context: Context, box: Box): Promise<Trace> {
  const trace: Trace = { flow: flow.description, context, steps: [], end: "done" };
  const id = ++box.seq;
  let calls: Call[] = [], tools: Map<string, Tool> | undefined;
  let session: Promise<Ctx> | undefined, release = () => {};

  // one request context for the whole run, made by the first tool call, as its owner; marked from the
  // start, so the flow skips every event of the run, those of setting the context up included
  const inRun = () => session ??= new Promise((resolve, reject) => {
    runAs(app, flow.owner, "sandbox.flow", () => {
      resolve(getCtx());
      return new Promise<void>((done) => release = done);
    }, { state: { flow } }).catch(reject);
  });

  box.runs.set(id, async (name, args) => {
    const call: Call = { tool: name, args };
    calls.push(call);
    tools ??= new Map(toTools(app.apiTree).map((t) => [t.name, t]));
    const tool = flow.tools?.includes(name) ? tools.get(name) : undefined;
    if (!tool) throw new Error(`flow: tool ${name} not allowed`);
    if (flow.test !== false && !name.endsWith("_get")) return void (call.skipped = true);
    const ctx = await inRun();
    return call.result = await requestStorage.run(ctx, () => tool.execute(args, ctx));
  });

  let value = event;
  try {
    for (const step of flow.steps) {
      calls = [];
      trace.steps.push({ description: step.description, calls });
      if ("debounce" in step) {
        if (await superseded(flow, step.debounce, value)) return { ...trace, end: "superseded" };
      } else {
        // the step's code goes in as an argument, so it sees nothing of the wrapper (`tool`, the run)
        const input = { value, context, owner: flow.owner, run: id, tools: flow.tools ?? [] };
        const result = await box.sandbox.run(`((fn) => (input, { tool }) => fn(input.value, {
          context: input.context,
          owner: input.owner,
          tools: Object.fromEntries(input.tools.map((n) => [n, (args) => tool(input.run, n, args)])),
        }))(${step.fn})`, input);
        if (result !== true) value = result; // true passes the input on: a filter is just its condition
      }
      trace.steps.at(-1)!.value = value;
      if (!value) return { ...trace, end: "stopped" };
    }
    return trace;
  } catch (e) {
    trace.steps.at(-1)!.error = (e as Error).message;
    return { ...trace, end: "error" };
  } finally {
    box.runs.delete(id);
    if (box.ended && !box.runs.size) box.sandbox.close();
    release();
  }
}

/** Waits `ms`; true if a later run of the flow reached this wait with the same key meanwhile. */
async function superseded(flow: Flow, { ms, by }: { ms: number; by?: string }, value: unknown) {
  const keys = waiting.get(flow) ?? waiting.set(flow, new Map()).get(flow)!;
  const key = String(by?.split(".").reduce((o: any, k) => o?.[k], value) ?? ""), mine = {};
  keys.set(key, mine);
  await new Promise((r) => setTimeout(r, ms));
  if (keys.get(key) !== mine) return true;
  keys.delete(key);
  return false;
}

/** The event as data: objects of a class become their string form (a DbTable its name), or go if
 *  they have none. */
function view(e: unknown): unknown {
  const plain = (v: any) => !v || typeof v !== "object" || Array.isArray(v) || "toJSON" in v ||
    Object.getPrototypeOf(v) === Object.prototype;
  const named = (v: any) => String(v).startsWith("[object") ? undefined : String(v);
  return JSON.parse(JSON.stringify(e, (_, v) => plain(v) ? v : named(v)) ?? "null");
}
