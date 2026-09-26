// deno-lint-ignore-file no-explicit-any
import { errMsg, sql } from "@qino/qino";

import type { App } from "@qino/qino";

/** What an adapter gets per call: the model and a fetch bound to its provider. */
export type Call = {
  provider: string;
  endpoint: string;
  /** The model's name at the provider */
  model: string;
  /** The provider's key in core.keys, empty for keyless (local) providers */
  key: string;
  /** Fetch `path` below the endpoint; throws an AiError unless ok. The provider's timeout counts
   *  silence, not length: every chunk of the body restarts it. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Report the usage: tokens, characters, seconds (transcription) or images generated. */
  usage(input?: number, output?: number): void;
};

/** A provider type (`ai1_provider.type`): one function per capability it serves natively. */
export type Adapter = Record<string, (call: Call, input: any) => Promise<unknown>>;

/** How a capability is served: needs derived from the input, ways through another capability. */
export type Capability = {
  needs?: (input: any) => string[];
  /** Answers of different models don't mix (embeddings): fall back only between one model's providers. */
  oneModel?: boolean;
  via?: Record<string, (input: any, next: (input: any) => Promise<any>) => Promise<unknown>>;
};

/**
 * `model` is tried first (it still falls back), `needs` are capabilities the model must have too,
 * `signal` cancels without fallback. `prefer` weighs what decides between the candidates: `cost`
 * (cheaper is better), `speed`, and any score of the models (`intelligence`, `coding` …), e.g.
 * `{ coding: 9, cost: 5, speed: 1 }`. Without it: good (the score named like the capability, as
 * `image`, where there is one, else `intelligence`), then cheap and fast.
 */
export type Opts = { model?: string; needs?: string[]; prefer?: Record<string, number>; signal?: AbortSignal };

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

type Candidate = {
  id: number; model_id: number; model: string; provider_model: string; provider: string; type: string; endpoint: string; timeout_ms: number;
  cost: number | null; speed: number | null;
  /** The weighted `prefer`, 0 … sum of the weights */
  rank: number;
};

const COOLDOWN = 60_000;
const cooldowns = new WeakMap<object, Map<number, number>>();

/**
 * Serve `capability`: the candidates (see `candidates`) one after the other, a provider whose adapter
 * lacks the capability through the capability's `via`; then the `via` capabilities themselves. Every
 * failure falls back to the next; overloaded providers rest for a while.
 */
export async function run(app: App, capability: string, input: unknown, opts: Opts = {}, chain: string[] = []): Promise<any> {
  if (!app.modules.linked("ai1")) throw new AiError('module "ai1" is not loaded');
  opts.signal?.throwIfAborted();
  const adapters: Record<string, Adapter> = Object.assign({}, ...app.modules.linked().map((mod) => mod.plugin.ai1Adapters));
  chain = [...chain, capability];
  const via = definitions(app, capability).flatMap((def) => Object.entries(def.via ?? {})).filter(([c]) => !chain.includes(c));
  const cooling = cooldowns.get(app) ?? cooldowns.set(app, new Map()).get(app)!;
  const errors: string[] = [];
  const stop = (e: unknown) => (e instanceof AiError && e.final) || opts.signal?.aborted;

  for (const candidate of await candidates(app, capability, input, opts)) {
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

const definitions = (app: App, capability: string): Capability[] => app.modules.linked().flatMap((mod) => mod.plugin.ai1Capabilities?.[capability] ?? []);

/**
 * Who would serve `capability` for `input`, in the order `run` tries them: enabled models that have
 * it and every need, fit the input's size, by the weighted `prefer`. Each criterion is scaled
 * between the candidates' worst (0) and best (1) — cost and speed by ratio (log), scores as they
 * are; unknown counts as worst.
 */
export async function candidates(app: App, capability: string, input: unknown, { model, needs: wanted = [], prefer }: Opts = {}): Promise<Candidate[]> {
  const defs = definitions(app, capability);
  const needs = [...new Set([...wanted, ...defs.flatMap((def) => def.needs?.(input) ?? [])])];
  // a rough size in tokens, so models with a too small context are left out (data URLs don't count)
  const size = Math.ceil((JSON.stringify(input, (_, v) => typeof v === "string" && v.startsWith("data:") ? "" : v)?.length ?? 0) / 4);
  const rows = await app.db.query<Candidate>`
    SELECT mp.id, m.id AS model_id, m.name AS model, mp.provider_model, p.name AS provider, p.type, p.endpoint, p.timeout_ms, mp.cost, mp.speed
    FROM ai1_model_capability c
    JOIN ai1_model m ON m.id = c.model_id
    JOIN ai1_model_provider mp ON mp.model_id = m.id
    JOIN ai1_provider p ON p.id = mp.provider_id
    WHERE c.capability = ${capability} AND m.enabled = ${true} AND mp.enabled = ${true} AND p.enabled = ${true}
      AND (m.context_length IS NULL OR m.context_length >= ${size})
    ${needs.length ? sql`AND (SELECT COUNT(*) FROM ai1_model_capability n WHERE n.model_id = m.id AND ${sql.in("n.capability", needs)}) = ${needs.length}` : sql.raw("")}`;
  const metrics = [...new Set([capability, "intelligence", ...Object.keys(prefer ?? {})])].filter((k) => k !== "cost" && k !== "speed");
  const scores = new Map((rows.length
    ? await app.db.query`SELECT model_id, metric, value FROM ai1_model_score WHERE ${sql.in("model_id", new Set(rows.map((r) => r.model_id)))} AND ${sql.in("metric", metrics)}`
    : []).map((s) => [`${s.model_id} ${s.metric}`, Number(s.value)]));
  prefer ??= { [rows.some((r) => scores.has(`${r.model_id} ${capability}`)) ? capability : "intelligence"]: 2, cost: 1, speed: 1 };
  const value = (r: Candidate, k: string) => (k === "cost" || k === "speed" ? r[k] : scores.get(`${r.model_id} ${k}`)) ?? undefined;
  // $0.10 → $1 is the step $1 → $10 is; free (0) counts as a thousandth of a dollar
  const scaled = (r: Candidate, k: string) => {
    const v = value(r, k);
    return v == null ? undefined : k === "cost" || k === "speed" ? Math.log(Math.max(v, 1e-3)) : v;
  };
  for (const r of rows) r.rank = 0;
  for (const [k, weight] of Object.entries(prefer)) {
    const known = rows.map((r) => scaled(r, k)).filter((v) => v != null);
    const min = Math.min(...known), max = Math.max(...known);
    for (const r of rows) {
      const v = scaled(r, k);
      if (v == null) continue;
      const share = max > min ? (v - min) / (max - min) : 1;
      r.rank += weight * (k === "cost" ? 1 - share : share);
    }
  }
  rows.sort((a, b) => b.rank - a.rank || a.id - b.id);
  const list = model ? [...rows.filter((c) => c.model === model), ...rows.filter((c) => c.model !== model)] : rows;
  return defs.some((def) => def.oneModel) ? list.filter((c) => c.model === list[0].model) : list;
}

async function bind(app: App, candidate: Candidate, used: { input: number; output: number }, signal?: AbortSignal): Promise<Call> {
  return {
    provider: candidate.provider,
    endpoint: candidate.endpoint,
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
    },
  };
}
