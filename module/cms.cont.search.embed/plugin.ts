import { html } from "@qino/qino";
import { find } from "@qino/qino/cms.embed";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const QUERY = "cms_search_embed";

const settingsSchema = {
  properties: {
    startPage: { type: "integer", minimum: 1, description: "Restricts results to this page and its descendants.", "x-html": { type: "qgcms-page" } },
    "hide input": { type: "boolean", description: "Renders only the results." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const query = String(ctx.req.query[QUERY] ?? "").trim(), t = ctx.app.t;
  const keep = Object.entries(ctx.req.query).filter(([key, value]) => key !== QUERY && typeof value === "string")
    .map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`);
  const form = await node.settings["hide input"] ? "" : html.async`<form>${keep}
    <input type=search name="${QUERY}" value="${query}" placeholder="${t`Search`}">
    <button>${t`Search`}</button>
  </form>`;
  if (!query) return html.async`<div>${form}</div>`;
  const startId = Number(node.settings.startPage() ?? 0);
  const items = await find(ctx, query, { start: startId || undefined });
  return html.async`<div>${form}
    ${items.length ? items.map(({ page, content }) => html.async`<div>
      <div>${node.cms.link(page)}</div>
      <p>${content.slice(0, 240)}</p>
    </div>`) : html.async`<div>${t`No results found`}</div>`}
  </div>`;
}

export const cms = { node: { render, settingsSchema } };
