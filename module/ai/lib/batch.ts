import { errMsg, requestStorage, runAs, unixTime } from "@qino/qino";

import { AiError, adapters, bind, candidates, request } from "./request.ts";

import type { App } from "@qino/qino";
import type { Call, Opts } from "./request.ts";

// Many calls at once, answered later (minutes, at most a day) at about half the price: through the
// batch API of the provider's type, as modules declare them (`aiBatches`). Without one, the calls are
// kept (`ai_batch_item`) and run a few at a time in the background. Either way each answer comes as
// `ai:batched`, after a restart too.

/** One call of a batch: `id` is the caller's, to know the answer by. */
export type BatchItem = { id: string; input: unknown };
/** What a batch API's `batch` gets. */
export type BatchInput = { capability: string; items: BatchItem[] };
/** What a batch API's `batched` yields per call: the answer or why there is none, `usage` as `Call.usage`. */
export type BatchAnswer = { id: string; output?: unknown; error?: string; usage?: (number | undefined)[] };
/** A provider type's batch API: `batch` submits and resolves to the batch's id at the provider,
 *  `batched` the answers once it ended, undefined before. */
export type BatchApi = {
  batch(call: Call, input: BatchInput): Promise<string>;
  batched(call: Call, batch: { handle: string; capability: string }): Promise<AsyncIterable<BatchAnswer> | undefined>;
};

/** The batch APIs of all linked modules, by `ai_provider.type`. */
const apis = (app: App): Record<string, BatchApi> => Object.assign({}, ...app.modules.linked().map((mod) => mod.plugin.aiBatches));

/** Run `fn` as user `usr`, as the batch was submitted (a ChatGPT plan, say, needs one); 0: as it is. */
const as = <T>(app: App, usr: number, fn: () => Promise<T>) => usr ? runAs(app, usr, "ai", fn) : fn();

/** Calls without a batch API run this many at a time. */
const PARALLEL = 4;

/** At most this per batch: the lower limits of the providers. */
const LIMIT = { items: 50_000, bytes: 100 * 2 ** 20 };

const size = (item: BatchItem) => JSON.stringify(item).length;

/** The items in batches within LIMIT. */
function* chunks(items: BatchItem[]) {
  for (let at = 0; at < items.length;) {
    let end = at, bytes = 0;
    while (end < items.length && end - at < LIMIT.items && (end === at || bytes + size(items[end]) <= LIMIT.bytes)) bytes += size(items[end++]);
    yield items.slice(at, end);
    at = end;
  }
}

/**
 * Submit `items` for `capability` (`text`, `structured`, `embed` …), all with one model chosen as
 * `request` does, the best that has a batch API. Resolves once submitted; the answers come later, as
 * `ai:batched` with `owner`: an answer may come twice after a crash. A structured answer is shaped by
 * its schema, not validated. The calls run, and their answers come, as the user who submitted them.
 */
export async function batch(app: App, capability: string, { owner, items }: { owner: string; items: BatchItem[] }, opts: Opts = {}): Promise<void> {
  let rest = items;
  const usr = requestStorage.getStore()?.userId ?? 0;
  const largest = items.reduce((a, b) => size(a) >= size(b) ? a : b, items[0]);
  for (const candidate of largest ? await candidates(app, capability, largest.input, opts) : []) {
    const api = apis(app)[candidate.type];
    if (!api || !adapters(app)[candidate.type]?.[capability]) continue;
    try {
      for (const chunk of chunks(rest)) {
        const call = await bind(app, candidate, { input: 0, output: 0 });
        const handle = await api.batch(call, { capability, items: chunk });
        await app.db.table("ai_batch").insert({
          owner, capability, model_provider_id: candidate.id, handle: String(handle), items: JSON.stringify(chunk.map((i) => i.id)), usr_id: usr, time: unixTime(),
        });
        rest = rest.slice(chunk.length);
      }
      break;
    } catch (e) {
      console.error(`[ai] batch at ${candidate.provider}/${candidate.model}:`, errMsg(e)); // the rest goes to the next
    }
  }
  if (!rest.length) return;
  // without a batch API: kept, so a restart goes on with them; what can be kept of `opts`
  const { model, modelProvider, needs, prefer } = opts;
  await app.db.transaction(async () => { // all of them, or none
    const id = Number(await app.db.table("ai_batch").insert({
      owner, capability, model_provider_id: 0, handle: "", items: "[]", opts: JSON.stringify({ model, modelProvider, needs, prefer }), usr_id: usr, time: unixTime(),
    }));
    for (const item of rest) await app.db.table("ai_batch_item").insert({ batch_id: id, id: item.id, input: JSON.stringify(item.input) });
  });
  work(app).catch(console.error);
}

const working = new WeakSet<App>();

/** The kept calls, `PARALLEL` at a time, falling back as `request` does; each is gone once answered.
 *  Runs once per app: started again while running, it returns. */
async function work(app: App) {
  if (working.has(app)) return;
  working.add(app);
  try {
    for (;;) {
      const next = await app.db.query`SELECT i.batch_id, i.id, i.input, b.owner, b.capability, b.opts, b.usr_id
        FROM ai_batch_item i JOIN ai_batch b ON b.id = i.batch_id ORDER BY i.batch_id LIMIT ${PARALLEL}`;
      if (!next.length) return;
      await Promise.all(next.map(async (item) => {
        const { owner, capability } = item, id = String(item.id);
        await as(app, Number(item.usr_id), async () => {
          const answer = await request(app, capability, JSON.parse(String(item.input)), JSON.parse(String(item.opts || "{}")))
            .then((output) => ({ output }), (e) => ({ error: errMsg(e) }));
          await app.fire("ai:batched", { owner, capability, id, ...answer });
        });
        await app.db.exec`DELETE FROM ai_batch_item WHERE batch_id = ${item.batch_id} AND id = ${id}`;
      }));
      for (const batch of new Set(next.map((i) => Number(i.batch_id)))) {
        if (!await app.db.one`SELECT 1 FROM ai_batch_item WHERE batch_id = ${batch} LIMIT 1`) await app.db.table("ai_batch").delete(batch);
      }
    }
  } finally {
    working.delete(app);
  }
}

/** Deliver the answers of the batches that ended, and go on with the kept calls (after a restart);
 *  run regularly (cron). A provider that can't be reached now is asked again next time. */
export async function poll(app: App): Promise<void> {
  work(app).catch(console.error);
  const rows = await app.db.query`
    SELECT b.id, b.owner, b.capability, b.handle, b.items, b.model_provider_id, b.usr_id,
      m.name AS model, mp.provider_model, p.name AS provider, p.type, p.endpoint, p.timeout_ms
    FROM ai_batch b
    JOIN ai_model_provider mp ON mp.id = b.model_provider_id
    JOIN ai_model m ON m.id = mp.model_id
    JOIN ai_provider p ON p.id = mp.provider_id`;
  for (const row of rows) {
    const api = apis(app)[row.type];
    if (!api) continue; // its module is not loaded now
    const { owner, capability, model, provider } = row, modelProvider = Number(row.model_provider_id);
    const missing = new Set<string>(JSON.parse(row.items));
    const deliver = (id: string, answer: { output?: unknown; error?: string }) =>
      (missing.delete(id), as(app, Number(row.usr_id), () => app.fire("ai:batched", { owner, capability, id, ...answer })));
    try {
      const answers = await api.batched(await bind(app, row as never, { input: 0, output: 0 }), { handle: row.handle, capability });
      if (!answers) continue;
      for await (const { id, output, error, usage: [input = 0, used = 0] = [] } of answers) {
        app.fire("ai:call", { capability, id: modelProvider, model, provider, ms: 0, input, output: used, error, batch: true }).catch(console.error);
        // a text answer names its model, as `request`'s does
        await deliver(id, error ? { error } : { output: capability === "text" ? { ...output as object, model, modelProvider } : output });
      }
    } catch (e) {
      if (e instanceof AiError && (e.status === 429 || (e.status ?? 0) >= 500)) continue;
      for (const id of missing) await deliver(id, { error: errMsg(e) });
    }
    for (const id of missing) await deliver(id, { error: "No answer" });
    await app.db.table("ai_batch").delete(row.id);
  }
}
