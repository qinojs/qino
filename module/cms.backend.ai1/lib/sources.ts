// deno-lint-ignore-file no-explicit-any
import { errMsg, sql, unixTime } from "@qino/qino";

import { CATALOG } from "../catalog.ts";

import type { App } from "@qino/qino";

const MODELS_DEV = "https://models.dev/api.json";
const BENCHMARKS = "https://artificialanalysis.ai/api/v2/data";
/** Artificial Analysis' arenas, by the capability their Elo tells the quality of. */
const ARENAS: Record<string, string> = { image: "media/text-to-image", speak: "media/text-to-speech" };
/** The Artificial Analysis key's name in core.keys. */
export const BENCHMARKS_KEY = "artificialanalysis.ai";
/** The benchmark's speed, a score like the others; measured speed replaces it from MEASURED_MS on. */
export const SPEED = "tokens_per_second";
const MEASURED_MS = 10_000;
/** An index no new model got for this long is no longer measured (math, since 2026-01): left out. */
const RETIRED_DAYS = 183;

const NOISE = new Set(["instruct", "chat", "latest", "preview"]);
/** A model name reduced for comparison, so llama-3.3-70b, Llama-3-3-Instruct-70B and llama-3.3-70b:free match. */
export const key = (name: string): string =>
  String(name).toLowerCase().split("/").pop()!.split(":")[0].split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w)).sort().join(" ");

/** The model a provider's id stands for: meta-llama/Llama-3.3-70B → llama-3.3-70b, so the same model
 *  at several providers is one; a variant (gpt-6-sol:batch, …:free) is another offer of it. */
export const unit = (id: string): string => id.split("/").pop()!.split(":")[0].toLowerCase();
/** How a model is recognised: claude-opus-4.8 (OpenRouter) is claude-opus-4-8 (aihubmix). */
const same = (name: string) => unit(name).replace(/[._]/g, "-");

const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const hostOf = (url: string) => URL.parse(url)?.host ?? "";
/** The domain without subdomains: api.groq.com and console.groq.com are both groq.com. */
const site = (url: string) => hostOf(url).split(".").slice(-2).join(".");

export const adapters = (app: App): Record<string, object> => Object.assign({}, ...app.modules.linked().map((mod) => mod.plugin.ai1Adapters));
/** Chat providers (OpenAI-compatible) list their models at /models. */
export const listing = (app: App, type: string): boolean => "text" in (adapters(app)[type] ?? {});

/** A provider's /models, and /embeddings/models where it keeps those apart (OpenRouter). Some
 *  (OpenRouter) describe each: price, context, modalities, parameters. */
export async function offered(app: App, provider: { name: string; endpoint: string }): Promise<any[]> {
  const key = String(await app.settings.core.keys[provider.name] ?? "");
  const list = async (path: string) => (await get(String(provider.endpoint).replace(/\/+$/, "") + path, key ? { authorization: "Bearer " + key } : {})).data ?? [];
  return [...await list("/models"), ...await list("/embeddings/models").catch(() => [])];
}

/** Such a description in models.dev's words, or undefined. Prices come per token. */
const described = (m: any) => m.pricing || m.architecture ? {
  id: m.id,
  description: m.description,
  modalities: { input: m.architecture?.input_modalities, output: m.architecture?.output_modalities },
  tool_call: m.supported_parameters?.includes("tools"),
  structured_output: m.supported_parameters?.some((p: string) => p === "response_format" || p === "structured_outputs"),
  limit: { context: m.context_length },
  cost: m.pricing && { input: Number(m.pricing.prompt) * 1e6, output: Number(m.pricing.completion) * 1e6 },
} : undefined;

/**
 * Write what a description (models.dev's words) tells: capabilities (only added, never removed) and
 * context length of the model; with `priced`, the offer's price — blended 3:1 input to output, per
 * million tokens (a negative price means "varies": left out).
 */
async function describe(app: App, offer: { id: number; model_id: number }, meta: any, priced: boolean): Promise<void> {
  const db = app.db;
  const { input, output } = meta.cost ?? {};
  if (priced && input >= 0 && output >= 0) await db.table("ai1_model_provider").update(offer.id, { cost: Math.round((input * 3 + output) / 4 * 1e4) / 1e4 });
  // embedding models: models.dev says their output is text, so it's the family or the name
  const embedding = meta.modalities?.output?.includes("embeddings") || meta.family === "text-embedding" || /embed/i.test(meta.id ?? "");
  const capabilities = embedding ? ["embed"] : [
    meta.modalities?.input?.includes("text") && meta.modalities?.output?.includes("text") && "text", // not speech to text
    meta.modalities?.input?.includes("image") && "vision",
    meta.tool_call && "tools",
    meta.structured_output && "structured",
    meta.modalities?.output?.includes("image") && "image",
    String(meta.modalities?.input) === "audio" && meta.modalities?.output?.includes("text") && "transcribe", // speech to text
    String(meta.modalities?.output) === "audio" && meta.modalities?.input?.includes("text") && "speak", // text to speech
  ].filter(Boolean);
  for (const capability of capabilities) await db.table("ai1_model_capability").ensure({ model_id: offer.model_id, capability });
  if (meta.limit?.context) await db.table("ai1_model").update(offer.model_id, { context_length: meta.limit.context });
}

/**
 * Every model of every listing provider, switched on (ai1 chooses by `prefer`); nothing existing is
 * switched. What a provider tells about its models is written; `priced` gets the offers it priced,
 * `told` the models' descriptions.
 */
export async function importModels(app: App, priced = new Set<number>(), told = new Map<number, string>()): Promise<string> {
  const db = app.db;
  const models = new Map((await db.query`SELECT id, name FROM ai1_model`).map((m) => [same(String(m.name)), { id: Number(m.id), name: String(m.name) }]));
  // an offer is a model at a provider under one id there: a variant is another
  const offers = new Map((await db.query`SELECT mp.id, mp.provider_id, mp.provider_model, m.name FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id`)
    .map((o) => [`${o.provider_id} ${o.provider_model || o.name}`, Number(o.id)]));
  const done: string[] = [];
  for (const provider of await db.query`SELECT id, name, type, endpoint FROM ai1_provider WHERE enabled = ${true}`) {
    const known = CATALOG.find((c) => c.name === provider.name);
    const extra = known?.models ?? [];
    if (!listing(app, provider.type) && !extra.length) continue;
    const listed = listing(app, provider.type) ? await offered(app, provider as any).catch((e) => (done.push(`${provider.name}: ${errMsg(e)}`), [])) : [];
    // :batch variants answer only through the asynchronous Batch API (OpenRouter), not a call
    const idOf = (m: any) => known?.plainIds ? String(m.id).split("/").pop()! : String(m.id);
    const entries = new Map<string, any>([...listed.filter((m) => !String(m.id).endsWith(":batch")).map((m): [string, any] => [idOf(m), described(m)]), ...extra.map((m): [string, any] => [m.id, m])]);
    let added = 0;
    await db.transaction(async () => {
      for (const [id, meta] of entries) {
        const name = unit(id); // the first one seen names the model
        let found = models.get(same(name));
        if (!found) models.set(same(name), found = { id: Number(await db.table("ai1_model").insert({ name })), name });
        const model = found.id;
        let offer = offers.get(`${provider.id} ${id}`);
        if (!offer) { // its name there, unless it is the model's
          offers.set(`${provider.id} ${id}`, offer = Number(await db.table("ai1_model_provider").insert({ model_id: model, provider_id: provider.id, provider_model: id === found.name ? "" : id })));
          added++;
        }
        const fromCatalog = extra.find((m) => m.id === id);
        if (fromCatalog) { // from the catalog
          if (fromCatalog.cost != null) await db.table("ai1_model_provider").update(offer, { cost: fromCatalog.cost });
          for (const capability of fromCatalog.capabilities) await db.table("ai1_model_capability").ensure({ model_id: model, capability });
          for (const [metric, value] of Object.entries(fromCatalog.scores ?? {})) await db.table("ai1_model_score").ensure({ model_id: model, metric, value });
        } else if (meta) {
          await describe(app, { id: offer, model_id: model }, meta, true);
        }
        if (fromCatalog?.cost != null || meta?.cost) priced.add(offer);
        if (meta?.description) told.set(model, String(meta.description));
      }
    });
    if (entries.size) done.push(`${provider.name}: ${entries.size} (${added} new)`);
  }
  return done.join(", ") || "no listing provider";
}

/**
 * models.dev: context length and capabilities per model, the price per provider — where the
 * provider didn't price it itself (`priced`).
 */
export async function importMeta(app: App, priced = new Set<number>()): Promise<number> {
  const db = app.db;
  const providers = Object.values(await get(MODELS_DEV)) as any[];
  // lookups by exact id and by reduced name: per provider, and over all
  const index = (models: any[]) => {
    const map = new Map<string, any>();
    for (const m of models) map.set(m.id.toLowerCase(), m).set(key(m.id), m);
    return map;
  };
  const byProvider = new Map(providers.map((p) => [p, index(Object.values(p.models ?? {}))]));
  const all = index(providers.flatMap((p) => Object.values(p.models ?? {})));
  const offers = await db.query`
    SELECT mp.id, mp.model_id, m.name AS model, mp.provider_model, p.name, p.endpoint
    FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id JOIN ai1_provider p ON p.id = mp.provider_id`;
  let found = 0;
  await db.transaction(async () => {
    for (const offer of offers) {
      const names = [offer.provider_model, offer.model].filter(Boolean).map((n) => String(n).toLowerCase());
      const find = (map?: Map<string, any>) => map && names.flatMap((n) => [map.get(n), map.get(key(n))]).find(Boolean);
      // the provider itself: its api or docs on our endpoint's domain, or its id among our name's parts
      const words = String(offer.name).split(".");
      const own = providers.filter((p) => words.includes(p.id) || [p.api, p.doc].some((url) => url && site(url) === site(offer.endpoint)))
        .map((p) => find(byProvider.get(p))).find(Boolean);
      const meta = own ?? find(all);
      if (!meta) continue;
      found++;
      await describe(app, offer as any, meta, !!own && !priced.has(offer.id));
    }
  });
  return found;
}

/**
 * Artificial Analysis: the LLMs' indexes (intelligence, coding, math, agentic …) and speed, as
 * scores named for `prefer` (the benchmarks behind the indexes are left out, and indexes no longer
 * measured, with the values they had: newer models would count as worst); and the arenas' Elo
 * for images and speech, as the scores `image` and `speak`: named like the capability, ai1 takes
 * them as its quality. A model the arena doesn't name may be named in its description (`told`):
 * "GPT-5 Image … with GPT Image 1". Needs a key.
 */
export async function importBenchmarks(app: App, told = new Map<number, string>()): Promise<number | undefined> {
  const db = app.db;
  const apiKey = String(await app.settings.core.keys[BENCHMARKS_KEY] ?? "");
  if (!apiKey) return;
  const load = async (path: string): Promise<any[]> => (await get(`${BENCHMARKS}/${path}`, { "x-api-key": apiKey })).data ?? [];
  const byName = (list: any[]) => {
    const map = new Map<string, any>();
    // the arenas name the model in brackets too: Nano Banana 2 (Gemini 3.1 Flash Image)
    for (const m of list) {
      for (const name of [m.slug, m.name, m.openrouter_api_id, ...String(m.name).match(/(?<=\()[^)]+/g) ?? []]) if (name) map.set(key(name), m);
    }
    return map;
  };
  const data = await load("llms/models");
  const llms = byName(data);
  // artificial_analysis_coding_index → coding; retired: no model of the last RETIRED_DAYS has it
  const indexName = (name: string) => name.replace(/^artificial_analysis_|^aa_/, "").replace(/_index$/, "");
  const since = new Date(Date.now() - RETIRED_DAYS * 86400_000).toISOString().slice(0, 10);
  const measured = new Set(data.filter((m) => String(m.release_date ?? "") >= since)
    .flatMap((m) => Object.entries(m.evaluations ?? {}).filter(([name, value]) => name.endsWith("_index") && typeof value === "number").map(([name]) => indexName(name))));
  const retired = [...new Set(data.flatMap((m) => Object.keys(m.evaluations ?? {}).filter((name) => name.endsWith("_index")).map(indexName)))].filter((name) => !measured.has(name));
  if (retired.length) await db.exec`DELETE FROM ai1_model_score WHERE ${sql.in("metric", retired)}`;
  const arenas = await Promise.all(Object.entries(ARENAS).map(async ([metric, path]) => {
    const list = await load(path).catch(() => []);
    // the arena's names without the setting in brackets, longest first: GPT Image 1 Mini before GPT Image 1
    const bare = list.map((m) => [String(m.name).replace(/\s*\([^)]*\)/g, "").trim(), m] as const).filter(([name]) => name).sort((a, b) => b[0].length - a[0].length);
    return [metric, byName(list), bare] as const;
  }));
  const within = (text: string | undefined, bare: (readonly [string, any])[]) =>
    text && bare.find(([name]) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w|\\.\\d)`, "i").test(text))?.[1];
  // unmeasured, a model's value is the median of its reasoning levels' (claude-opus-5-5-high …)
  const measure = (m: any, get: (m: any) => unknown) => {
    const own = get(m);
    if (typeof own === "number" && own) return own; // speed 0 is "not measured" too
    const levels = data.filter((x) => String(x.slug).startsWith(`${m.slug}-`)).map(get).filter((v): v is number => typeof v === "number" && !!v).sort((a, b) => a - b);
    return levels.length ? levels[Math.floor(levels.length / 2)] : undefined;
  };
  const indexes = [...new Set(data.flatMap((m) => Object.keys(m.evaluations ?? {}).filter((name) => name.endsWith("_index"))))].filter((name) => !retired.includes(indexName(name)));
  const names = new Map<number, string[]>();
  for (const r of await db.query`SELECT m.id, m.name, mp.provider_model FROM ai1_model m LEFT JOIN ai1_model_provider mp ON mp.model_id = m.id`) {
    names.set(r.id, [...names.get(r.id) ?? [String(r.name)], ...r.provider_model ? [String(r.provider_model)] : []]);
  }
  const contexts = new Map((await db.query`SELECT id, context_length FROM ai1_model`).map((m) => [m.id, m.context_length]));
  let found = 0;
  await db.transaction(async () => {
    for (const [model, list] of names) {
      const find = (map: Map<string, any>) => list.map((name) => map.get(key(name))).find(Boolean);
      const m = find(llms);
      const scores = [
        ...m ? indexes.map((name) => [indexName(name), measure(m, (x) => x.evaluations?.[name])]) : [],
        ...m ? [[SPEED, measure(m, (x) => x.median_output_tokens_per_second)]] : [],
        ...arenas.map(([metric, map, bare]) => [metric, (find(map) ?? within(told.get(model), bare))?.elo]),
      ].filter(([, value]) => typeof value === "number");
      if (!scores.length) continue;
      found++;
      for (const [metric, value] of scores) await db.table("ai1_model_score").ensure({ model_id: model, metric, value });
      if (!contexts.get(model) && m?.context_window_tokens) await db.table("ai1_model").update(model, { context_length: m.context_window_tokens }); // models.dev first
    }
  });
  return found;
}

/** Count an `ai1:call` and its usage; successful ones that give output tokens are timed for the speed
 *  (whatever the capability; translation services and embeddings give none, so units don't mix). */
export async function record(app: App, e: { id: number; ms: number; input: number; output: number; error?: string }): Promise<void> {
  const timed = !e.error && e.output > 0;
  await app.db.table("ai1_model_provider_stat").ensure({ model_provider_id: e.id });
  await app.db.exec`UPDATE ai1_model_provider_stat SET
    calls = calls + 1, errors = errors + ${e.error ? 1 : 0}, used_input = used_input + ${e.input}, used_output = used_output + ${e.output},
    ms = ms + ${timed ? e.ms : 0}, output = output + ${timed ? e.output : 0},
    last_error = COALESCE(${e.error ?? null}, last_error), last_at = ${unixTime()}
    WHERE model_provider_id = ${e.id}`;
}

/** `speed` per provider: measured where there is enough, else the benchmark's, else whatever was measured. */
export async function applySpeed(app: App): Promise<void> {
  const rows = await app.db.query`
    SELECT mp.id, s.ms, s.output, b.value AS benchmark
    FROM ai1_model_provider mp
    LEFT JOIN ai1_model_provider_stat s ON s.model_provider_id = mp.id
    LEFT JOIN ai1_model_score b ON b.model_id = mp.model_id AND b.metric = ${SPEED}`;
  await app.db.transaction(async () => {
    for (const r of rows) {
      const measured = r.ms > 0 ? r.output / (r.ms / 1000) : null;
      const speed = r.ms >= MEASURED_MS ? measured : r.benchmark ?? measured;
      if (speed != null) await app.db.table("ai1_model_provider").update(r.id, { speed: Math.round(speed * 10) / 10 });
    }
  });
}

/** Halve the counts, so what happens now outweighs the past (run daily: a half-life of a day). The
 *  usage stays a total. */
export async function fade(app: App): Promise<void> {
  await app.db.exec`UPDATE ai1_model_provider_stat SET calls = calls / 2, errors = errors / 2, ms = ms / 2, output = output / 2`;
}

/** All sources, one after the other; a failing one does not stop the rest. */
export async function evaluate(app: App): Promise<string> {
  const settle = <T>(promise: Promise<T>) => promise.catch((e) => `error: ${errMsg(e)}`);
  const priced = new Set<number>(); // by the providers themselves: models.dev doesn't overwrite it
  const told = new Map<number, string>(); // the providers' descriptions of their models
  const models = await settle(importModels(app, priced, told));
  const meta = await settle(importMeta(app, priced));
  const benchmarks = await settle(importBenchmarks(app, told));
  await applySpeed(app);
  await fade(app);
  return `models: ${models} · models.dev: ${meta} · Artificial Analysis: ${benchmarks ?? "no key"}`;
}
