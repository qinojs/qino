// One row of a database table — the page's `?id=` — to read and edit in place: its fields are set in
// the widget like those of cms.cont.dbtable, whose query, types and actions it shares. Pairs with a
// list's detail page.
import { hee, html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { api, Query, route, settingsSchema as listSchema, show } from "@qino/qino/cms.cont.dbtable";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const NAME = "cms.cont.dbrow";

const { table, where, field_order, fields } = listSchema.properties;
const settingsSchema = { properties: { table, where, field_order, fields } };

/** The row's fields, label beside value; a row `where` does not reach is not found. */
async function row(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  const id = vars.id ?? ctx.req.query.id;
  const q = await Query.of(node, { id });
  if (!q) return "";
  const row = await q.row(node.db, id ?? null);
  if (!row) return html.async`<p>${node.app.t`Not found.`}</p>`;
  const edit = await node.edit();
  let body = "";
  for (const f of q.shown()) {
    const text = await node.showText(f.name + "_title");
    const label = edit ? `<span contenteditable cmstxt=${text.id}>${text.plain().trim() ? text : hee(f.name)}</span>` : hee(text.plain().trim() || f.name);
    body += `<tr><th>${label}<td>${await show(f, row[f.name], node.app, f.is("edit"))}`;
  }
  return html.raw(`<table class=u2-table data-row="${hee(String(row.__id))}">${body}</table>`);
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["class/table/table.css", "class/card/card.css"]);
  if (!await Query.of(node)) return html.async`<div class=u2-card><div>${node.app.t`Choose the table in the widget.`}</div></div>`;
  return html.async`<div class=u2-card data-id="${String(ctx.req.query.id ?? "")}">
	${node.cms.text(node, "title", { tag: "h2", class: "-head" })}
	<div cms-part=row>${row(node, { ctx, vars: {} })}</div>
</div>`;
}

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("route", ({ ctx }: { ctx: Ctx }) => route(app, ctx, NAME), { signal });
}

export const cms = {
  node: {
    render,
    api,
    settingsSchema,
    parts: { row },
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    widget: "pub/widget.js",
  },
};
