import { html, sql } from "@qino/qino";
import { search } from "@qino/qino/ai1.embed";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const QUERY = "cms_search_embed";

const settingsSchema = {
  properties: {
    startPage: { type: "integer", minimum: 1, description: "Restricts results to this page and its descendants.", "x-html": { type: "qgcms-page" } },
    "hide input": { type: "boolean", description: "Renders only the results." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const query = String(ctx.req.query[QUERY] ?? "").trim(), t = ctx.app.t;
  const keep = Object.entries(ctx.req.query).filter(([key, value]) => key !== QUERY && typeof value === "string")
    .map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`);
  const form = await node.settings["hide input"] ? "" : html.async`<form>${keep}
    <input type=search name="${QUERY}" value="${query}" placeholder="${t`Search`}">
    <button>${t`Search`}</button>
  </form>`;
  if (!query) return html.async`<div>${form}</div>`;
  const db = ctx.app.db, startId = Number(node.settings.startPage() ?? 0);
  const start = startId ? await node.cms.node(startId) : undefined;
  // best hit first, so each page keeps its best content
  const found = new Map<number, { page: Node; content: string }>();
  // texts only in the page language, files only on pages; access, visibility and the start page are checked per page below
  const onPage = sql`e.file_id IN (SELECT file_id FROM page_file)`;
  const names = { node_text: sql`e.lang = ${ctx.lang}`, file_text: onPage, file_image: onPage };
  const hits = await search(ctx.app, names, query, { limit: 100 });
  const files = await db.query`SELECT file_id, page_id FROM page_file WHERE ${sql.in("file_id", hits.map((h) => h.key.file_id).filter(Boolean))}`;
  for (const hit of hits) {
    const pages = hit.name === "node_text" ? [hit.key.node_id] : files.filter((f) => Number(f.file_id) === Number(hit.key.file_id)).map((f) => f.page_id);
    for (const id of pages) {
      const source = await node.cms.node(Number(id)), page = await source.page();
      if (!page.vs.searchable || !await source.isReadable() || start && !await source.in(start)) continue;
      if (!found.has(page.id)) found.set(page.id, { page, content: hit.content });
    }
  }
  const items = [...found.values()].slice(0, 20);
  return html.async`<div>${form}
    ${items.length ? items.map(({ page, content }) => html.async`<div>
      <div>${node.cms.link(page)}</div>
      <p>${content.slice(0, 240)}</p>
    </div>`) : html.async`<div>${t`No results found`}</div>`}
  </div>`;
}

export const cms = { node: { render, settingsSchema } };
