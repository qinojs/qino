// deno-lint-ignore-file no-explicit-any
import { errMsg } from "@qino/qino";
import { text } from "@qino/qino/ai1";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type Vars = Record<string, any>;

// Editable columns per table, with the type the posted value becomes.
const EDITABLE: Record<string, Record<string, "string" | "number" | "boolean">> = {
  ai1_provider: { type: "string", endpoint: "string", timeout_ms: "number", enabled: "boolean" },
  ai1_model: { name: "string", enabled: "boolean" },
  ai1_model_provider: { provider_id: "number", provider_model: "string", cost: "number", speed: "number", enabled: "boolean" },
};

function coerce(type: string, value: unknown): unknown {
  if (type === "boolean") return !!value;
  if (type === "string") return String(value ?? "").trim();
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${value}`);
  return n;
}

/** The ids of an OpenAI-type provider's `/models`. */
async function offered(app: App, providerId: number): Promise<string[]> {
  const p = await app.db.row`SELECT name, endpoint FROM ai1_provider WHERE id = ${providerId}`;
  if (!p) throw new Error("Unknown provider");
  const key = String(await app.settings.core.keys[p.name] ?? "");
  const res = await fetch(String(p.endpoint).replace(/\/+$/, "") + "/models", {
    headers: key ? { authorization: "Bearer " + key } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).data ?? []).map((m: { id: unknown }) => String(m.id)).sort();
}

/** Node access is the permission. Answers `{ ok, message? }`, lists with `list`. */
export default async function api(node: Node, vars: Vars): Promise<unknown> {
  const app = node.app, db = app.db;
  try {
    if (vars.set) {
      const { table, id, column, value } = vars.set;
      const type = EDITABLE[table]?.[column];
      if (!type) return { ok: false, message: `Not editable: ${table}.${column}` };
      await db.table(table).update(Number(id), { [column]: coerce(type, value) });
      return { ok: true };
    }
    if (vars.capability) {
      const { model, name, priority } = vars.capability;
      const where = { model_id: Number(model), capability: String(name) };
      if (priority === "" || priority == null) await db.table("ai1_model_capability").deleteWhere(where);
      else await db.table("ai1_model_capability").ensure({ ...where, priority: coerce("number", priority) });
      return { ok: true };
    }
    if (vars.add === "provider") {
      const name = String(vars.name ?? "").trim();
      if (!name) return { ok: false, message: await app.t`A name is required.` };
      await db.table("ai1_provider").insert({ name, type: String(vars.type || "openai"), endpoint: String(vars.endpoint ?? "").trim() });
      return { ok: true };
    }
    if (vars.add === "model") {
      const name = String(vars.name ?? "").trim();
      if (!name) return { ok: false, message: await app.t`A name is required.` };
      await db.table("ai1_model").insert({ name });
      return { ok: true };
    }
    if (vars.add === "offer") {
      await db.table("ai1_model_provider").insert({ model_id: Number(vars.model), provider_id: Number(vars.provider_id) });
      return { ok: true };
    }
    if (vars.remove) {
      const { table, id } = vars.remove;
      if (!EDITABLE[table]) return { ok: false, message: `Not removable: ${table}` };
      await db.table(table).delete(Number(id)); // capabilities and providers of a model cascade
      return { ok: true };
    }
    if (vars.key) {
      const { provider, value } = vars.key;
      if (!await db.one`SELECT id FROM ai1_provider WHERE name = ${provider}`) return { ok: false, message: "Unknown provider" };
      await app.settings.core.keys[provider](String(value ?? "").trim() || undefined);
      return { ok: true };
    }
    if (vars.offered) {
      const provider = Number(vars.offered);
      const adopted = await db.col`
        SELECT COALESCE(NULLIF(mp.provider_model, ''), m.name) FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id
        WHERE mp.provider_id = ${provider}`;
      return { ok: true, list: await offered(app, provider), adopted: adopted.map(String) };
    }
    if (vars.adopt) {
      // The model is the name without the provider's prefix (meta-llama/llama-3.3-70b → llama-3.3-70b),
      // so the same model from several providers becomes one.
      const provider = Number(vars.adopt.provider), id = String(vars.adopt.id ?? "").trim();
      const name = id.split("/").pop()!;
      if (!name) return { ok: false, message: await app.t`A name is required.` };
      const model = Number(await db.one`SELECT id FROM ai1_model WHERE name = ${name}` ?? await db.table("ai1_model").insert({ name }));
      if (!await db.one`SELECT id FROM ai1_model_provider WHERE model_id = ${model} AND provider_id = ${provider}`) {
        await db.table("ai1_model_provider").insert({ model_id: model, provider_id: provider, provider_model: id === name ? "" : id });
      }
      return { ok: true };
    }
    if (vars.try) {
      const { prompt, model, prefer } = vars.try;
      const start = performance.now();
      const answer = await text(app, String(prompt ?? ""), { model: model || undefined, prefer: prefer === "speed" ? "speed" : "cost" });
      return { ok: true, ...answer, ms: Math.round(performance.now() - start) };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
