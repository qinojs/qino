import { html, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { list, write } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Direct links", de: "Direkte Links", fr: "Liens directs", it: "Collegamenti diretti" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/* Direct links are created in the node's URL panel, the admin box on 404 pages, and here. This
   list shows all of them. Data is in page_redirect. */
async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const { t } = node.app;

  let message: HtmlString | "" = "";
  if (vars.create) {
    const error = await write(node.app, vars.create as Record<string, string>);
    message = error
      ? html`<u2-alert open variant=warning>${error}</u2-alert>`
      : html`<u2-alert open variant=success>${await t`Direct link created.`}</u2-alert>`;
  }

  const search = ctx.req.query.search ?? "";

  /* No own stylesheet (cms.layout.backend styles .u2-card and .u2-table). flex-grow:0 overrides
     the layout's `.u2-card { flex-grow:1 }`, so the table isn't stretched. */
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex-grow:0">
        <div class=-head>${t`New direct link`}</div>
        <div>
            <form data-create>
                <label>${t`Request`} <input name=request required size=16 placeholder="${t`e.g. menu`}"></label>
                <label>${t`Target`} <input type=qgcms-page name=redirect required size=24 placeholder="${t`page or URL`}"></label>
                <button>${t`Create`}</button>
            </form>
            ${message}
            <p style="max-width:30rem"><small>${t`A direct link answers a request that no page url claims. It may point at a page or at any URL.`}</small>
        </div>
    </div>

    <div class=u2-card style="flex-grow:0">
        <div class=-head>${t`Direct links`}</div>
        <div><input type=search data-search value="${search}" placeholder="${t`Search`}…"></div>
        <table class=u2-table cms-part=list>${list(node, { vars: { search } })}</table>
    </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  // Just the count: what is broken is one click away, and the widget must not scan the tree for it.
  const total = await app.db.one`SELECT count(*) FROM ${sql.id("page_redirect")}`;
  return html.async`<div class=-body><b>${Number(total)}</b> ${app.t`direct links`}</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
