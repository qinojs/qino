import { html, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { collection, collections, create, drop, embeddings, indexFiles, search } from "@qino/qino/ai1.embed";
import { sync } from "@qino/qino/cms.embed";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.ai1.embed", { en: "Embeddings", de: "Embeddings" });
}

async function render(node: Node) {
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
  const auto = !!await app.settings["cms.embed"].auto, files = !!await app.settings["ai1.embed"].files;
  const chunkChars = Number(await app.settings["ai1.embed"].chunkChars);
  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head>Embeddings</div>
    <table class=u2-table>
      <thead><tr>
        <th>Table
        <th>Key${rows.map((c) => html`
        <th data-id=${c.id}>
          <span style="color:${backend.uniqueColor(c.model)}">${c.model}</span>/${c.dimensions}<br>
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
    <div class=-head>Index</div>
    <form data-sync class=u2-flex>
      <button>Index nodes and missing files</button>
      <label><input type=checkbox data-auto ${auto ? "checked" : ""}> nodes each hour</label>
      <label><input type=checkbox data-files ${files ? "checked" : ""}> files on upload and each hour</label>
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

async function api(node: Node, vars: any) {
  const app = node.app, settings = app.settings["ai1.embed"];
  try {
    if (vars.sync) {
      const nodes = await sync(app), files = await indexFiles(app);
      return { ok: true, result: { nodes: nodes.nodes, files: files.files, errors: [...nodes.errors, ...files.errors] } };
    }
    if (vars.search) return { ok: true, hits: await search(app, Object.fromEntries(embeddings(app.db).map(({ name }) => [name, true as const])), String(vars.search)) };
    if (vars.create) await create(app, vars.create.model, Number(vars.create.dimensions));
    else if (vars.primary) await settings.primary(Number(vars.primary));
    else if (vars.drop) await drop(app, Number(vars.drop));
    else if (vars.config) {
      const chunkChars = Number(vars.config.chunkChars);
      if (!Number.isInteger(chunkChars) || chunkChars < 100) throw new Error("A chunk needs at least 100 characters");
      await settings.chunkChars(chunkChars);
    } else if ("auto" in vars) await app.settings["cms.embed"].auto(!!vars.auto);
    else if ("files" in vars) await settings.files(!!vars.files);
    else return null;
    return { ok: true };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
