// deno-lint-ignore-file no-explicit-any
import { errMsg, sql } from "@qino/qino";

import type { App } from "@qino/qino";

/** What an adapter gets per call: the model and a fetch bound to its provider. */
export type Call = {
  provider: string;
  /** The model's name at the provider */
  model: string;
  /** The provider's key in core.keys, empty for keyless (local) providers */
  key: string;
  /** Fetch `path` below the endpoint; throws an AiError unless ok. The provider's timeout counts
   *  silence, not length: every chunk of the body restarts it. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Count usage on this model at this provider. */
  usage(input?: number, output?: number): void;
};

/** A provider type (`ai1_provider.type`): one function per capability it serves natively. */
export type Adapter = Record<string, (call: Call, input: any) => Promise<unknown>>;

/** Per capability: needs derived from the input, and ways to serve it through another capability. */
export type Task = {
  needs?: (input: any) => string[];
  via?: Record<string, (input: any, next: (input: any) => Promise<any>) => Promise<unknown>>;
};

/** `model` is tried first (it still falls back), `needs` are capabilities the model must have too,
 *  `prefer` orders the providers of one model (default cost), `signal` cancels without fallback. */
export type Opts = { model?: string; needs?: string[]; prefer?: "cost" | "speed"; signal?: AbortSignal };

/** `status` as HTTP: 502 unreachable, 504 timed out. `final`: the caller already got part of the
 *  answer, so no other model may take over. */
export class AiError extends Error {
  status?: number;
  final?: boolean;
  constructor(message: string, status?: number, final?: boolean) {
    super(message);
    this.status = status;
    this.final = final;
  }
}

type Candidate = { id: number; model: string; provider_model: string; provider: string; type: string; endpoint: string; timeout_ms: number };

const COOLDOWN = 60_000;
const cooldowns = new WeakMap<object, Map<number, number>>();

/**
 * Serve `capability`: the enabled models that have it (and `needs`), by priority, each through its
 * providers by `prefer`. A provider whose adapter lacks the capability serves it through the task's
 * `via`, then the `via` capabilities themselves. Every failure falls back to the next; overloaded
 * providers rest for a while.
 */
export async function run(app: App, capability: string, input: unknown, opts: Opts = {}, chain: string[] = []): Promise<any> {
  if (!app.modules.linked("ai1")) throw new AiError('module "ai1" is not loaded');
  opts.signal?.throwIfAborted();
  const mods = app.modules.linked();
  const adapters: Record<string, Adapter> = Object.assign({}, ...mods.map((mod) => mod.plugin.ai1Adapters));
  const tasks: Task[] = mods.flatMap((mod) => mod.plugin.ai1Tasks?.[capability] ?? []);
  chain = [...chain, capability];
  const via = tasks.flatMap((task) => Object.entries(task.via ?? {})).filter(([c]) => !chain.includes(c));
  const needs = [...new Set([...opts.needs ?? [], ...tasks.flatMap((task) => task.needs?.(input) ?? [])])];
  const cooling = cooldowns.get(app) ?? cooldowns.set(app, new Map()).get(app)!;
  const errors: string[] = [];
  const stop = (e: unknown) => (e instanceof AiError && e.final) || opts.signal?.aborted;

  for (const candidate of await candidates(app, capability, needs, opts)) {
    if ((cooling.get(candidate.id) ?? 0) > Date.now()) continue;
    const adapter = adapters[candidate.type] ?? {};
    const [through, convert] = via.find(([c]) => adapter[c]) ?? [];
    if (!adapter[capability] && !convert) continue;
    // every attempt is reported (`ai1:call`), so others can measure speed and reliability
    const start = performance.now(), used = { input: 0, output: 0 };
    const report = (error?: unknown) => app.fire("ai1:call", {
      capability, id: candidate.id, model: candidate.model, provider: candidate.provider,
      ms: Math.round(performance.now() - start), ...used, error: error === undefined ? undefined : errMsg(error),
    }).catch(console.error);
    try {
      const call = await bind(app, candidate, used, opts.signal);
      const result = await (adapter[capability] ? adapter[capability](call, input) : convert!(input, (i) => adapter[through!](call, i)));
      report();
      return result;
    } catch (e) {
      report(e);
      if (stop(e)) throw e;
      if (e instanceof AiError && (e.status === 429 || (e.status ?? 0) >= 500)) cooling.set(candidate.id, Date.now() + COOLDOWN);
      errors.push(`${candidate.provider}/${candidate.model}: ${errMsg(e)}`);
    }
  }
  for (const [through, convert] of via) {
    try { return await convert(input, (i) => run(app, through, i, opts, chain)); }
    catch (e) {
      if (stop(e)) throw e;
      errors.push(errMsg(e));
    }
  }
  throw new AiError(errors.join("; ") || `No model for "${capability}"`);
}

async function candidates(app: App, capability: string, needs: string[], { model, prefer }: Opts): Promise<Candidate[]> {
  const rows = await app.db.query<Candidate>`
    SELECT mp.id, m.name AS model, mp.provider_model, p.name AS provider, p.type, p.endpoint, p.timeout_ms
    FROM ai1_model_capability c
    JOIN ai1_model m ON m.id = c.model_id
    JOIN ai1_model_provider mp ON mp.model_id = m.id
    JOIN ai1_provider p ON p.id = mp.provider_id
    WHERE c.capability = ${capability} AND m.enabled = ${true} AND mp.enabled = ${true} AND p.enabled = ${true}
    ${needs.length ? sql`AND (SELECT COUNT(*) FROM ai1_model_capability n WHERE n.model_id = m.id AND ${sql.in("n.capability", needs)}) = ${needs.length}` : sql.raw("")}
    ORDER BY c.priority DESC, m.id, ${sql.raw(prefer === "speed" ? "mp.speed IS NULL, mp.speed DESC" : "mp.cost IS NULL, mp.cost")}, mp.id`;
  return model ? [...rows.filter((c) => c.model === model), ...rows.filter((c) => c.model !== model)] : rows;
}

async function bind(app: App, candidate: Candidate, used: { input: number; output: number }, signal?: AbortSignal): Promise<Call> {
  return {
    provider: candidate.provider,
    model: candidate.provider_model || candidate.model,
    key: String(await app.settings.core.keys[candidate.provider] ?? ""),
    fetch: async (path, init) => {
      const ms = candidate.timeout_ms || 60000;
      const idle = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new AiError(`No answer for ${ms / 1000}s`, 504)), ms);
      };
      wait();
      const res = await fetch(candidate.endpoint.replace(/\/+$/, "") + path, { ...init, signal: signal ? AbortSignal.any([idle.signal, signal]) : idle.signal })
        .catch((e) => {
          clearTimeout(timer);
          throw e instanceof AiError || signal?.aborted ? e : new AiError(errMsg(e), 502);
        });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        clearTimeout(timer);
        throw new AiError(`HTTP ${res.status}: ${text.slice(0, 300).trim()}`, res.status);
      }
      const body = res.body?.pipeThrough(new TransformStream({ transform: (chunk, out) => (wait(), out.enqueue(chunk)), flush: () => clearTimeout(timer), cancel: () => clearTimeout(timer) }));
      return new Response(body, res);
    },
    usage: (input = 0, output = 0) => {
      used.input += input;
      used.output += output;
      if (input || output) app.db.exec`UPDATE ai1_model_provider SET used_input = used_input + ${input}, used_output = used_output + ${output} WHERE id = ${candidate.id}`.catch(console.error);
    },
  };
}
