import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { create, search, sync } from "@qino/qino/ai1.embed";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.ai1.embed", { en: "Embeddings", de: "Embeddings" });
}

async function render(node: Node): Promise<HtmlString> {
  const db = node.app.db;
  const rows = await db.query`SELECT c.*, COUNT(e.id) AS entries, MAX(e.updated_at) AS updated_at
    FROM ai1_embed_collection c LEFT JOIN ai1_embed_entry e ON e.collection_id = c.id
    GROUP BY c.id, c.name, c.model, c.dimensions, c.revision, c.enabled ORDER BY c.id`;
  const models = await db.col`SELECT DISTINCT m.name FROM ai1_model m JOIN ai1_model_capability c ON c.model_id = m.id WHERE c.capability = ${"embed"} ORDER BY m.name`;
  const auto = !!await node.app.settings["ai1.embed"].auto;
  const chosen = String(await node.app.settings["ai1.embed"].primary || "");
  const primary = rows.some((row) => row.name === chosen) ? chosen : String(rows[0]?.name || "");
  const chunkChars = Number(await node.app.settings["ai1.embed"].chunkChars) || 4000;
  return html.async`<div class=u2-card>
    <div class=-head>Embeddings</div>
    <table class=u2-table>
      <thead><tr><th>Collection<th>Primary<th>Entries<th>Updated<th>Enabled<th>
      <tbody>${rows.map((row) => html.async`<tr data-id="${row.id}">
        <th>${row.name}<td><input type=radio name=primary data-primary ${row.name === primary ? "checked" : ""}>
        <td>${row.entries}<td>${row.updated_at ?? "–"}
        <td><input type=checkbox data-enable ${row.enabled ? "checked" : ""}>
        <td><button type=button data-remove u2-confirm="Remove ${row.name} and its vectors?">Remove</button>`)}</tbody>
    </table>
    <form data-add class=u2-flex>
      <select name=model required><option value="">Embedding model${models.map((model) => html`<option value="${model}">${model}`)}</select>
      <input type=number name=dimensions min=1 required placeholder=Dimensions>
      <button>Add</button>
    </form>
    <form data-sync class=u2-flex>
      <select name=collection aria-label="Collection">${rows.map((row) => html`<option value="${row.id}" ${row.name === primary ? "selected" : ""}>${row.name}`)}</select>
      <button>Index text and file tables</button>
      <output></output>
    </form>
    <label><input type=checkbox data-auto ${auto ? "checked" : ""}> Maintain text and file index after writes</label>
    <form data-config class=u2-flex>
      <label>Characters per text part <input type=number name=chunkChars min=100 value="${chunkChars}"></label>
      <button>Save</button>
    </form>
    <form data-search class=u2-flex>
      <select name=collection>${rows.map((row) => html`<option value="${row.id}" ${row.name === primary ? "selected" : ""}>${row.name}`)}</select>
      <input name=query required placeholder="Test semantic search">
      <button>Search</button>
      <output></output>
    </form>
  </div>`;
}

async function api(node: Node, vars: Record<string, unknown>) {
  const app = node.app, db = app.db;
  try {
    if (vars.add) {
      const { model, dimensions } = vars.add as { model: string; dimensions: number | string };
      await create(app, model, Number(dimensions));
      return { ok: true };
    }
    if (vars.primary) {
      const row = await db.table("ai1_embed_collection").selectByID(Number(vars.primary));
      if (!row) throw new Error("Collection not found");
      await app.settings["ai1.embed"].primary(String(row.name));
      return { ok: true };
    }
    if (vars.enable) {
      const { id, on } = vars.enable as { id: number; on: boolean };
      await db.table("ai1_embed_collection").update(Number(id), { enabled: !!on });
      return { ok: true };
    }
    if (vars.remove) {
      const row = await db.table("ai1_embed_collection").selectByID(Number(vars.remove));
      if (!row) throw new Error("Collection not found");
      await db.table("ai1_embed_collection").delete(Number(vars.remove));
      if (String(await app.settings["ai1.embed"].primary || "") === row.name) await app.settings["ai1.embed"].primary("");
      return { ok: true };
    }
    if (vars.sync) {
      const row = await db.table("ai1_embed_collection").selectByID(Number(vars.sync));
      if (!row) throw new Error("Collection not found");
      return { ok: true, result: await sync(app, { model: String(row.model), dimensions: Number(row.dimensions) }) };
    }
    if ("auto" in vars) {
      await app.settings["ai1.embed"].auto(!!vars.auto);
      return { ok: true };
    }
    if (vars.config) {
      const { chunkChars: size } = vars.config as { chunkChars: unknown };
      const chunkChars = Number(size);
      if (!Number.isInteger(chunkChars) || chunkChars < 100) throw new Error("Characters per part must be at least 100");
      await app.settings["ai1.embed"].chunkChars(chunkChars);
      return { ok: true };
    }
    if (vars.search) {
      const { collection: id, query } = vars.search as { collection: string; query: string | number[] };
      const row = await db.table("ai1_embed_collection").selectByID(Number(id));
      if (!row) throw new Error("Collection not found");
      return { ok: true, hits: await search(app, query, { model: String(row.model), dimensions: Number(row.dimensions), limit: 10 }) };
    }
    return null;
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
