import { unixTime } from "@qino/qino";

import type { App } from "@qino/qino";

/** The benchmark's speed, a score like the others; measured speed replaces it from MEASURED_MS on. */
export const SPEED = "tokens_per_second";
const MEASURED_MS = 10_000;

/** Count an `ai1:call` and its usage, and log it if it failed; successful ones that give output
 *  tokens are timed for the speed (whatever the capability; translation services and embeddings
 *  give none, so units don't mix). */
export async function record(app: App, e: { id: number; capability: string; ms: number; input: number; output: number; error?: string }): Promise<void> {
  const timed = !e.error && e.output > 0, time = unixTime();
  await app.db.table("ai1_model_provider_stat").ensure({ model_provider_id: e.id });
  await app.db.exec`UPDATE ai1_model_provider_stat SET
    calls = calls + 1, errors = errors + ${e.error ? 1 : 0}, used_input = used_input + ${e.input}, used_output = used_output + ${e.output},
    ms = ms + ${timed ? e.ms : 0}, output = output + ${timed ? e.output : 0},
    last_error = COALESCE(${e.error ?? null}, last_error), last_at = ${time}
    WHERE model_provider_id = ${e.id}`;
  if (e.error) await app.db.table("ai1_call_error").insert({ model_provider_id: e.id, capability: e.capability, time, message: e.error });
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
