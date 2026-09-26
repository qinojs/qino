import { html } from "@qino/qino";
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
  const found = new Map<number, { page: Node; content: string; score: number }>();
  for (const hit of await search(ctx.app, query, { limit: 100 })) {
    let pages: number[] = [];
    if (hit.table === "text_lang") {
      const [id, lang] = String(hit.id).split(":");
      if (lang !== ctx.lang) continue;
      pages = (await db.col`SELECT page_id FROM page_text WHERE text_id = ${Number(id)}
        UNION SELECT id FROM page WHERE title_id = ${Number(id)}`).map(Number);
    } else if (hit.table === "file") {
      pages = (await db.col`SELECT page_id FROM page_file WHERE file_id = ${Number(hit.id)}`).map(Number);
    }
    for (const id of pages) {
      const source = await node.cms.node(id), page = await source.page();
      if (!page.vs.searchable || !await source.isReadable() || start && !await source.in(start)) continue;
      if (!found.has(page.id)) found.set(page.id, { page, content: hit.content, score: hit.score });
    }
  }
  const items = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 20);
  return html.async`<div>${form}
    ${items.length ? items.map(({ page, content }) => html.async`<div>
      <div>${node.cms.link(page)}</div>
      <p>${content.slice(0, 240)}</p>
    </div>`) : html.async`<div>${t`No results found`}</div>`}
  </div>`;
}

export const cms = { node: { render, settingsSchema } };
