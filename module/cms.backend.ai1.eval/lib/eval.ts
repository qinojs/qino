// deno-lint-ignore-file no-explicit-any
import { errMsg, unixTime } from "@qino/qino";

import type { App } from "@qino/qino";

const MODELS_DEV = "https://models.dev/api.json";
const BENCHMARKS = "https://artificialanalysis.ai/api/v2/data/llms/models";
/** The Artificial Analysis key's name in core.keys. */
export const BENCHMARKS_KEY = "artificialanalysis.ai";
/** Measured speed replaces the benchmark's from this much generation time (ms). */
const MEASURED_MS = 10_000;

const NOISE = new Set(["instruct", "chat", "latest", "preview"]);
/** A model name reduced for comparison, so llama-3.3-70b and Llama-3-3-Instruct-70B match. */
export const key = (name: string): string =>
  String(name).toLowerCase().split("/").pop()!.split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w)).sort().join(" ");

const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
};

const hostOf = (url: string) => URL.parse(url)?.host ?? "";

/** Count an `ai1:call`; successful text calls are timed for the speed. */
export async function record(app: App, e: { id: number; capability: string; ms: number; output: number; error?: string }): Promise<void> {
  const text = e.capability === "text" && !e.error;
  await app.db.table("ai1_eval_stat").ensure({ model_provider_id: e.id });
  await app.db.exec`UPDATE ai1_eval_stat SET
    calls = calls + 1, errors = errors + ${e.error ? 1 : 0},
    text_ms = text_ms + ${text ? e.ms : 0}, text_output = text_output + ${text ? e.output : 0},
    last_error = COALESCE(${e.error ?? null}, last_error), last_at = ${unixTime()}
    WHERE model_provider_id = ${e.id}`;
}

/**
 * models.dev: the models' context and capabilities (text, vision, tools, object), and each
 * provider's price — blended 3:1 input to output, per million tokens. Capabilities are only added,
 * never removed; priorities stay as they are.
 */
export async function importMeta(app: App): Promise<number> {
  const db = app.db;
  const providers = Object.values(await get(MODELS_DEV)) as any[];
  const offers = await db.query`
    SELECT mp.id, mp.model_id, m.name AS model, mp.provider_model, p.name, p.endpoint
    FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id JOIN ai1_provider p ON p.id = mp.provider_id`;
  let found = 0;
  for (const offer of offers) {
    const names = [offer.provider_model, offer.model].filter(Boolean).map(String);
    const find = (list: any[]) => list.flatMap((p) => Object.values(p.models ?? {}) as any[])
      .find((m) => names.some((n) => m.id.toLowerCase() === n.toLowerCase() || key(m.id) === key(n)));
    // the provider itself: same api host, or its id among the parts of our name or host
    const words = [...String(offer.name).split("."), ...hostOf(offer.endpoint).split(".")];
    const own = find(providers.filter((p) => words.includes(p.id) || (p.api && hostOf(p.api) === hostOf(offer.endpoint))));
    const meta = own ?? find(providers);
    if (!meta) continue;
    found++;
    if (own?.cost) await db.table("ai1_model_provider").update(offer.id, { cost: (own.cost.input * 3 + own.cost.output) / 4 });
    const capabilities = [
      meta.modalities?.output?.includes("text") && "text",
      meta.modalities?.input?.includes("image") && "vision",
      meta.tool_call && "tools",
      meta.structured_output && "object",
    ].filter(Boolean);
    for (const capability of capabilities) await db.table("ai1_model_capability").ensure({ model_id: offer.model_id, capability });
    await db.table("ai1_eval_model").ensure({ model_id: offer.model_id, ...meta.limit?.context && { context: meta.limit.context }, checked_at: unixTime() }); // an unknown context keeps the known one
  }
  return found;
}

/**
 * Artificial Analysis: every evaluation (intelligence, coding, agentic, multilingual … indexes and
 * the benchmarks behind them), speed and time to the first token per model. Needs a key.
 */
export async function importBenchmarks(app: App): Promise<number | undefined> {
  const db = app.db;
  const apiKey = String(await app.settings.core.keys[BENCHMARKS_KEY] ?? "");
  if (!apiKey) return;
  const byKey = new Map<string, any>();
  for (const m of (await get(BENCHMARKS, { "x-api-key": apiKey })).data ?? []) {
    for (const name of [m.slug, m.name, m.openrouter_api_id]) if (name) byKey.set(key(name), m);
  }
  let found = 0;
  for (const model of await db.query`SELECT id, name FROM ai1_model`) {
    const names = [model.name, ...await db.col`SELECT provider_model FROM ai1_model_provider WHERE model_id = ${model.id} AND provider_model <> ''`];
    const m = names.map((name) => byKey.get(key(String(name)))).find(Boolean);
    if (!m) continue;
    found++;
    for (const [metric, value] of Object.entries(m.evaluations ?? {})) {
      if (typeof value === "number") await db.table("ai1_eval_score").ensure({ model_id: model.id, metric, value });
    }
    const context = await db.one`SELECT context FROM ai1_eval_model WHERE model_id = ${model.id}`;
    await db.table("ai1_eval_model").ensure({
      model_id: model.id,
      bench_speed: m.median_output_tokens_per_second ?? null,
      bench_ttft: m.median_time_to_first_token_seconds ?? null,
      ...!context && m.context_window_tokens && { context: m.context_window_tokens }, // models.dev first
      checked_at: unixTime(),
    });
  }
  return found;
}

/** `speed` per provider: measured where there is enough, else the benchmark's. */
export async function applySpeed(app: App): Promise<void> {
  const rows = await app.db.query`
    SELECT mp.id, s.text_ms, s.text_output, e.bench_speed
    FROM ai1_model_provider mp
    LEFT JOIN ai1_eval_stat s ON s.model_provider_id = mp.id
    LEFT JOIN ai1_eval_model e ON e.model_id = mp.model_id`;
  for (const r of rows) {
    const speed = r.text_ms >= MEASURED_MS ? r.text_output / (r.text_ms / 1000) : r.bench_speed;
    if (speed != null) await app.db.table("ai1_model_provider").update(r.id, { speed: Math.round(speed * 10) / 10 });
  }
}

/** Everything, one after the other (both write ai1_eval_model); a failing source does not stop the rest. */
export async function evaluate(app: App): Promise<string> {
  const settle = <T>(promise: Promise<T>) => promise.catch((e) => `error: ${errMsg(e)}`);
  const meta = await settle(importMeta(app));
  const benchmarks = await settle(importBenchmarks(app));
  await applySpeed(app);
  return `models.dev: ${meta} · Artificial Analysis: ${benchmarks ?? "no key"}`;
}
