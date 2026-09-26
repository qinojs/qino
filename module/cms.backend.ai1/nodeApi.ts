// deno-lint-ignore-file no-explicit-any
import { errMsg, requestStorage, sql } from "@qino/qino";
import { candidates, run } from "@qino/qino/ai1";

import { BENCHMARKS_KEY, evaluate } from "./lib/sources.ts";
import { matching } from "./render.ts";

import type { Node } from "@qino/qino/cms";

// Editable columns per table, with the type the posted value becomes.
const EDITABLE: Record<string, Record<string, "string" | "number" | "boolean">> = {
  ai1_provider: { type: "string", endpoint: "string", timeout_ms: "number", enabled: "boolean" },
  ai1_model: { name: "string", context_length: "number", enabled: "boolean" },
  ai1_model_provider: { provider_id: "number", provider_model: "string", cost: "number", speed: "number", enabled: "boolean" },
};

/** `prefer` from the sliders: `{ name: weight }`; none set means ai1's own. */
function weights(prefer: unknown): Record<string, number> | undefined {
  if (!prefer || typeof prefer !== "object" || Object.values(prefer).some((w) => typeof w !== "number")) throw new Error("Weights: { name: number }");
  return Object.keys(prefer).length ? prefer as Record<string, number> : undefined;
}

function coerce(type: string, value: unknown): unknown {
  if (type === "boolean") return !!value;
  if (type === "string") return String(value ?? "").trim();
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${value}`);
  return n;
}

/** Node access is the permission. Answers `{ ok, message? }`. */
export default async function api(node: Node, vars: Record<string, any>): Promise<unknown> {
  const app = node.app, db = app.db;
  const key = (name: string, value: unknown) => app.settings.core.keys[name](String(value ?? "").trim() || undefined);
  try {
    if (vars.set) {
      const { table, id, column, value } = vars.set;
      const type = EDITABLE[table]?.[column];
      if (!type) return { ok: false, message: `Not editable: ${table}.${column}` };
      await db.table(table).update(Number(id), { [column]: coerce(type, value) });
      return { ok: true };
    }
    if (vars.capability) {
      const { model, name, on } = vars.capability;
      const row = { model_id: Number(model), capability: String(name) };
      await (on ? db.table("ai1_model_capability").ensure(row) : db.table("ai1_model_capability").deleteWhere(row));
      return { ok: true };
    }
    if (vars.add) {
      const name = String(vars.name ?? "").trim();
      if (vars.add === "offer") await db.table("ai1_model_provider").insert({ model_id: Number(vars.model), provider_id: Number(vars.provider_id) });
      else if (!name) return { ok: false, message: await app.t`A name is required.` };
      else if (vars.add === "provider") await db.table("ai1_provider").insert({ name, type: String(vars.type || "openai"), endpoint: String(vars.endpoint ?? "").trim() });
      else if (vars.add === "model") await db.table("ai1_model").insert({ name });
      return { ok: true };
    }
    if (vars.switch) {
      // every model the filter matches, whether on or off now
      const where = matching(vars.switch);
      const ids = await db.col`SELECT m.id FROM ai1_model m ${where.length ? sql`WHERE ${sql.join(where, " AND ")}` : sql``}`;
      if (ids.length) await db.exec`UPDATE ai1_model SET enabled = ${!!vars.switch.on} WHERE ${sql.in("id", ids)}`;
      return { ok: true, message: `${ids.length} ${vars.switch.on ? await app.t`models on` : await app.t`models off`}` };
    }
    if (vars.remove) {
      const { table, id } = vars.remove;
      if (!EDITABLE[table]) return { ok: false, message: `Not removable: ${table}` };
      await db.table(table).delete(Number(id)); // what hangs on it cascades
      return { ok: true };
    }
    if (vars.key) {
      const { provider, value } = vars.key;
      if (!await db.one`SELECT id FROM ai1_provider WHERE name = ${provider}`) return { ok: false, message: "Unknown provider" };
      await key(provider, value);
      return { ok: true };
    }
    if ("benchmarkKey" in vars) {
      await key(BENCHMARKS_KEY, vars.benchmarkKey);
      return { ok: true, message: await app.t`Saved.` };
    }
    if (vars.evaluate) return { ok: true, message: await evaluate(app) };
    if (vars.preview) {
      // the order run tries: who serves it, then who serves it through another capability
      const { capability = "text", input = {}, model, prefer } = vars.preview;
      const opts = { model: model || undefined, prefer: weights(prefer) };
      const via = app.modules.linked().flatMap((mod) => Object.keys(mod.plugin.ai1Capabilities?.[capability]?.via ?? {}));
      const lists = await Promise.all([capability, ...via].map((c) => candidates(app, String(c), input, opts)));
      const list = lists.flatMap((l, i) => l.map((c) => ({ model: c.model, provider: c.provider, rank: Math.round(c.rank * 100) / 100, via: i ? via[i - 1] : undefined })));
      return { ok: true, list: list.slice(0, 8) };
    }
    if (vars.try) {
      const { capability = "text", input = {}, model, prefer } = vars.try;
      if (input.file != null) { // an upload, as a data URL
        if (!String(input.file).startsWith("data:")) return { ok: false, message: "A file is expected" };
        input.file = new File([await (await fetch(input.file)).blob()], String(input.name ?? "audio"));
        delete input.name;
      }
      // who was tried: the ai1:call events of this request
      const ctx = requestStorage.getStore(), done = new AbortController(), tried: any[] = [];
      app.on("ai1:call", (e) => { if (requestStorage.getStore() === ctx) tried.push({ model: e.model, provider: e.provider, ms: e.ms, error: e.error }); }, { signal: done.signal });
      const start = performance.now();
      try {
        const result = await run(app, String(capability), input, { model: model || undefined, prefer: weights(prefer) });
        return { ok: true, result, ms: Math.round(performance.now() - start), tried };
      } finally {
        done.abort();
      }
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
