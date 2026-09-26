import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { collection, search, sync } from "@qino/qino/ai1.embed";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.ai1.embed", { en: "Embeddings", de: "Embeddings" });
}

async function render(node: Node): Promise<HtmlString> {
  const db = node.app.db;
  const rows = await db.query`SELECT c.*, COUNT(e.id) AS entries, MAX(e.updated_at) AS updated_at
    FROM ai1_embed_collection c LEFT JOIN ai1_embed_entry e ON e.collection_id = c.id
    GROUP BY c.id, c.name, c.model, c.dimensions, c.revision, c.enabled ORDER BY c.name`;
  const models = await db.col`SELECT DISTINCT m.name FROM ai1_model m JOIN ai1_model_capability c ON c.model_id = m.id WHERE c.capability = ${"embed"} ORDER BY m.name`;
  const auto = !!await node.app.settings["ai1.embed"].auto;
  const sourceCollection = String(await node.app.settings["ai1.embed"].collection || "main");
  const chunkChars = Number(await node.app.settings["ai1.embed"].chunkChars) || 4000;
  return html.async`<div class=u2-card>
    <div class=-head>Embeddings</div>
    <table class=u2-table>
      <thead><tr><th>Collection<th>Model<th>Dimensions<th>Entries<th>Updated<th>Enabled<th>
      <tbody>${rows.map((row) => html.async`<tr data-id="${row.id}">
        <th>${row.name}<td>${row.model}<td>${row.dimensions ?? "–"}<td>${row.entries}<td>${row.updated_at ?? "–"}
        <td><input type=checkbox data-enable ${row.enabled ? "checked" : ""}>
        <td><button type=button data-remove u2-confirm="Remove ${row.name} and its vectors?">Remove</button>`)}</tbody>
    </table>
    <form data-add class=u2-flex>
      <input name=name required placeholder=Collection>
      <select name=model required><option value="">Embedding model${models.map((model) => html`<option value="${model}">${model}`)}</select>
      <button>Add</button>
    </form>
    <form data-sync class=u2-flex>
      <input name=collection value="${sourceCollection}" aria-label="Collection">
      <button>Index text and file tables</button>
      <output></output>
    </form>
    <label><input type=checkbox data-auto ${auto ? "checked" : ""}> Maintain text and file index after writes</label>
    <form data-config class=u2-flex>
      <label>Automatic collection <input name=collection value="${sourceCollection}" required></label>
      <label>Characters per text part <input type=number name=chunkChars min=100 value="${chunkChars}"></label>
      <button>Save</button>
    </form>
    <form data-search class=u2-flex>
      <select name=collection>${rows.map((row) => html`<option value="${row.name}">${row.name}`)}</select>
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
      const { name, model } = vars.add as { name: string; model: string };
      if (!name?.trim() || !model?.trim()) throw new Error("A collection and model are required");
      await collection(app, name.trim(), model.trim());
      return { ok: true };
    }
    if (vars.enable) {
      const { id, on } = vars.enable as { id: number; on: boolean };
      await db.table("ai1_embed_collection").update(Number(id), { enabled: !!on });
      return { ok: true };
    }
    if (vars.remove) {
      await db.table("ai1_embed_collection").delete(Number(vars.remove));
      return { ok: true };
    }
    if (vars.sync) return { ok: true, result: await sync(app, String(vars.sync)) };
    if ("auto" in vars) {
      await app.settings["ai1.embed"].auto(!!vars.auto);
      return { ok: true };
    }
    if (vars.config) {
      const { collection: name, chunkChars: size } = vars.config as { collection: string; chunkChars: unknown };
      const chunkChars = Number(size);
      if (!Number.isInteger(chunkChars) || chunkChars < 100) throw new Error("Characters per part must be at least 100");
      if (!name?.trim()) throw new Error("An automatic collection is required");
      await app.settings["ai1.embed"].collection(name.trim());
      await app.settings["ai1.embed"].chunkChars(chunkChars);
      return { ok: true };
    }
    if (vars.search) {
      const { collection: name, query } = vars.search as { collection: string; query: string | number[] };
      return { ok: true, hits: await search(app, name, query, { limit: 10 }) };
    }
    return null;
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
