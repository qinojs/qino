// deno-lint-ignore-file no-explicit-any
import { getCtx, requestStorage, runAs, toTools } from "@qino/qino";
import { Sandbox } from "@qino/qino/sandbox";

import { hosts } from "./lib/hosts.ts";

export { history } from "./lib/history.ts";
export { hosts } from "./lib/hosts.ts";
export { keep } from "./lib/table.ts";
export { toFlow } from "./lib/row.ts";

import type { App, Ctx, Tool } from "@qino/qino";

type Context = { user?: number };
type Call = { tool: string; args: unknown; result?: unknown; skipped?: true };
type State = Record<string, unknown>;
type Trace = {
  flow: string;
  context: Context;
  calls: Call[];
  result?: unknown;
  state?: State; // the changed state, kept for the next run
  error?: string;
  end: "done" | "error";
};

/** A flow: when the event fires on the host, its code runs. */
export type Flow = {
  description: string;
  on: { host: string; event: string }; // the app or one of its emitters ("app", "db"), and its event
  owner: number; // tools run with this user's rights
  tools?: string[]; // the tools it may call, by name
  test?: boolean; // unless false: only `*_get` tools take effect, the other calls are recorded
  code: string; // a function body; it sees `event`, `tools`, `state`, `context` and `owner`
  state?: State; // the flow's memory: what a run leaves in it, the next one finds (not in a test)
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
    // a request still making its session (its own insert into sess) knows no user yet
    const event = view(e), context = { user: ctx?.sess ? ctx.userId || undefined : undefined };
    // in the background: the emitter never waits for a flow
    exec(app, flow, event, context, box).then(report, console.error);
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

/** Runs the code in the flow's sandbox; the trace has its tool calls, its result and a changed state. */
async function exec(app: App, flow: Flow, event: unknown, context: Context, box: Box): Promise<Trace> {
  const trace: Trace = { flow: flow.description, context, calls: [], end: "done" };
  const id = ++box.seq;
  let tools: Map<string, Tool> | undefined, session: Promise<Ctx> | undefined, release = () => {};

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
    trace.calls.push(call);
    tools ??= new Map(toTools(app.apiTree).map((t) => [t.name, t]));
    const tool = flow.tools?.includes(name) ? tools.get(name) : undefined;
    if (!tool) throw new Error(`flow: tool ${name} not allowed`);
    if (flow.test !== false && !name.endsWith("_get")) return void (call.skipped = true);
    const ctx = await inRun();
    return call.result = await requestStorage.run(ctx, () => tool.execute(args, ctx));
  });

  try {
    // the code goes in as an argument, so it sees nothing of the wrapper (`tool`, the run)
    const input = { event, context, owner: flow.owner, run: id, tools: flow.tools ?? [], state: flow.state ?? {} };
    const { result, state } = await box.sandbox.run<{ result: unknown; state: State }>(
      `((fn) => async (input, { tool }) => ({
        result: await fn(
          input.event,
          Object.fromEntries(input.tools.map((n) => [n, (args) => tool(input.run, n, args)])),
          input.state,
          input.context,
          input.owner,
        ),
        state: input.state,
      }))(async (event, tools, state, context, owner) => {\n${flow.code}\n})`,
      input,
    );
    trace.result = result;
    // a test keeps nothing; runs at once each start from the state before them, the last one wins
    if (flow.test === false && JSON.stringify(state) !== JSON.stringify(flow.state ?? {})) {
      trace.state = flow.state = state;
    }
    return trace;
  } catch (e) {
    return { ...trace, error: (e as Error).message, end: "error" };
  } finally {
    box.runs.delete(id);
    if (box.ended && !box.runs.size) box.sandbox.close();
    release();
  }
}

/** The event as data: objects of a class become their string form (a DbTable its name), or go if
 *  they have none. */
function view(e: unknown): unknown {
  const plain = (v: any) => !v || typeof v !== "object" || Array.isArray(v) || "toJSON" in v ||
    Object.getPrototypeOf(v) === Object.prototype;
  const named = (v: any) => String(v).startsWith("[object") ? undefined : String(v);
  return JSON.parse(JSON.stringify(e, (_, v) => plain(v) ? v : named(v)) ?? "null");
}
