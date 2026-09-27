import { html, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { collection, collections, create, drop, embeddings, search } from "@qino/qino/ai1.embed";
import { sync } from "@qino/qino/cms.embed";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.ai1.embed", { en: "Embeddings", de: "Embeddings" });
}

async function render(node: Node): Promise<HtmlString> {
  const app = node.app, db = app.db;
  const tables = embeddings(db), rows = await collections(app);
  const counts = new Map<string, number>(); // "table collection" → vectors
  for (const { table } of tables) {
    for (const row of await db.query`SELECT collection_id, COUNT(*) AS n FROM ${sql.id(table)} GROUP BY collection_id`) {
      counts.set(`${table} ${row.collection_id}`, Number(row.n));
    }
  }
  const primary = (await collection(app))?.id;
  const models = await db.col`SELECT DISTINCT m.name FROM ai1_model m JOIN ai1_model_capability c ON c.model_id = m.id WHERE c.capability = ${"embed"} ORDER BY m.name`;
  const auto = !!await app.settings["cms.embed"].auto;
  const chunkChars = Number(await app.settings["ai1.embed"].chunkChars) || 4000;
  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head>Embeddings</div>
    <table class=u2-table>
      <thead><tr>
        <th>Table
        <th>Key${rows.map((c) => html`
        <th data-id=${c.id}>
          ${c.model}/${c.dimensions}<br>
          <label><input type=radio name=primary data-primary ${c.id === primary ? "checked" : ""}> primary</label>
          <button type=button data-drop u2-confirm="Delete ${c.model} and its vectors?">Delete</button>`)}
      <tbody>${tables.map(({ table, keys }) => html`<tr>
        <th>${table}
        <td>${keys.join(", ")}${rows.map((c) => html`
        <td>${counts.get(`${table} ${c.id}`) ?? 0}`)}`)}</tbody>
    </table>
    <form data-create class=u2-flex>
      <select name=model required><option value="">Embedding model${models.map((model) => html`<option value="${model}">${model}`)}</select>
      <input type=number name=dimensions min=1 required placeholder=Dimensions>
      <button>Add collection</button>
    </form>
    <form data-config class=u2-flex>
      <label>Characters per chunk <input type=number name=chunkChars min=100 value=${chunkChars}></label>
      <button>Save</button>
    </form>
  </div>
  <div class=u2-card>
    <div class=-head>CMS index</div>
    <form data-sync class=u2-flex>
      <button>Index nodes and files</button>
      <label><input type=checkbox data-auto ${auto ? "checked" : ""}> each hour</label>
    </form>
  </div>
  <div class=u2-card>
    <div class=-head>Test search</div>
    <form data-search class=u2-flex>
      <input name=query required placeholder="Search by meaning">
      <button>Search</button>
    </form>
    <table class=u2-table data-hits></table>
  </div>
</div>`;
}

async function api(node: Node, vars: Record<string, unknown>) {
  const app = node.app;
  try {
    if (vars.create) {
      const { model, dimensions } = vars.create as { model: string; dimensions: string };
      await create(app, model, Number(dimensions));
      return { ok: true };
    }
    if (vars.primary) {
      const c = await collection(app, Number(vars.primary));
      if (!c) throw new Error("Collection not found");
      await app.settings["ai1.embed"].primary(c.id);
      return { ok: true };
    }
    if (vars.drop) {
      await drop(app, Number(vars.drop));
      return { ok: true };
    }
    if (vars.config) {
      const chunkChars = Number((vars.config as { chunkChars: unknown }).chunkChars);
      if (!Number.isInteger(chunkChars) || chunkChars < 100) throw new Error("A chunk needs at least 100 characters");
      await app.settings["ai1.embed"].chunkChars(chunkChars);
      return { ok: true };
    }
    if ("auto" in vars) {
      await app.settings["cms.embed"].auto(!!vars.auto);
      return { ok: true };
    }
    if (vars.sync) return { ok: true, result: await sync(app) };
    if (vars.search) {
      const all = Object.fromEntries(embeddings(app.db).map(({ name }) => [name, true as const]));
      return { ok: true, hits: await search(app, all, String(vars.search), { limit: 10 }) };
    }
    return null;
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
