import { errMsg, unixTime } from "@qino/qino";

import { AiError, adapters, bind, candidates, request } from "./request.ts";

import type { App } from "@qino/qino";
import type { Opts } from "./request.ts";

// Many calls at once, answered later (minutes, at most a day) at about half the price: through the
// batch API of a provider whose adapter has `batch` and `batched`. Without one, the calls run one by
// one in the background. Either way each answer comes as `ai:batched`, after a restart too.

/** One call of a batch: `id` is the caller's, to know the answer by. */
export type BatchItem = { id: string; input: unknown };
/** What an adapter's `batch` gets. */
export type BatchInput = { capability: string; items: BatchItem[] };
/** What an adapter's `batched` yields per call: the answer or why there is none, `usage` as `Call.usage`. */
export type BatchAnswer = { id: string; output?: unknown; error?: string; usage?: (number | undefined)[] };

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
 * its schema, not validated.
 */
export async function batch(app: App, capability: string, { owner, items }: { owner: string; items: BatchItem[] }, opts: Opts = {}): Promise<void> {
  let rest = items;
  const largest = items.reduce((a, b) => size(a) >= size(b) ? a : b, items[0]);
  for (const candidate of largest ? await candidates(app, capability, largest.input, opts) : []) {
    const adapter = adapters(app)[candidate.type] ?? {};
    if (!adapter.batch || !adapter[capability]) continue;
    try {
      for (const chunk of chunks(rest)) {
        const call = await bind(app, candidate, { input: 0, output: 0 });
        const handle = await adapter.batch(call, { capability, items: chunk });
        await app.db.table("ai_batch").insert({
          owner, capability, model_provider_id: candidate.id, handle: String(handle), items: JSON.stringify(chunk.map((i) => i.id)), time: unixTime(),
        });
        rest = rest.slice(chunk.length);
      }
      break;
    } catch (e) {
      console.error(`[ai] batch at ${candidate.provider}/${candidate.model}:`, errMsg(e)); // the rest goes to the next
    }
  }
  if (rest.length) direct(app, capability, owner, rest, opts).catch(console.error);
}

/** Without a batch API: one by one in the background, falling back as `request` does. */
async function direct(app: App, capability: string, owner: string, items: BatchItem[], opts: Opts) {
  for (const { id, input } of items) {
    const answer = await request(app, capability, input, opts).then((output) => ({ output }), (e) => ({ error: errMsg(e) }));
    await app.fire("ai:batched", { owner, capability, id, ...answer });
  }
}

/** Deliver the answers of the batches that ended; run regularly (cron). A provider that can't be
 *  reached now is asked again next time. */
export async function poll(app: App): Promise<void> {
  const rows = await app.db.query`
    SELECT b.id, b.owner, b.capability, b.handle, b.items, b.model_provider_id,
      m.name AS model, mp.provider_model, p.name AS provider, p.type, p.endpoint, p.timeout_ms
    FROM ai_batch b
    JOIN ai_model_provider mp ON mp.id = b.model_provider_id
    JOIN ai_model m ON m.id = mp.model_id
    JOIN ai_provider p ON p.id = mp.provider_id`;
  for (const row of rows) {
    const adapter = adapters(app)[row.type];
    if (!adapter?.batched) continue; // its module is not loaded now
    const { owner, capability, model, provider } = row, modelProvider = Number(row.model_provider_id);
    const missing = new Set<string>(JSON.parse(row.items));
    const deliver = (id: string, answer: { output?: unknown; error?: string }) => (missing.delete(id), app.fire("ai:batched", { owner, capability, id, ...answer }));
    try {
      const answers = await adapter.batched(await bind(app, row as never, { input: 0, output: 0 }), { handle: row.handle, capability }) as AsyncIterable<BatchAnswer> | undefined;
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
