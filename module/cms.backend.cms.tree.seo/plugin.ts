import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { breadcrumb, pageTitle, walk } from "@qino/qino/cms.backend.cms.tree";
import { imageUrl, text } from "@qino/qino/cms.seo";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "SEO", de: "SEO" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function renderTree(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  const path = await breadcrumb(node, ctx);

  return html.async`<div class=u2-card style="flex:0 1 auto">
  <div class=-head>${t`SEO`} (${ctx.lang})</div>
  <div>${path}</div>
  <table class="u2-table cmsBeTree">
    <thead><tr>
      <th style="width:1.25rem">${t`No.`}
      <th style="min-width:15.625rem">${t`Page`}
      <th>${t`Title`}
      <th>${t`Description`}
      <th>${t`Share title`}
      <th>${t`Share description`}
      <th>${t`Share image`}
    <tbody cms-part=list>${list(node, { ctx })}
  </table>
</div>`;
}

/** A cell. With a range, the length and "!" when outside what search engines show in full. */
function field(t: App["t"], value: string, min = 0, max = 0) {
  const n = value.length;
  return html.async`<td>${value}${max
    ? html.async` <small>(${t`${n} characters`}${n < min || n > max ? ", !" : ""})</small>` : ""}`;
}

function listRows(node: Node, args: { ctx: Ctx; vars?: Record<string, unknown> }) {
  const t = node.app.t, ctx = args.ctx;
  // pages only, and only those the user may read
  return walk(node, args, async ({ page, access, lead }) => {
    const title = await pageTitle(page, ctx.lang);
    const file = await page.cms.image(page, { use: "share" });
    const seoTitle = await text(page, "_title") || title, descr = await text(page, "_description");
    // editable rows open the edit dialog on click
    const edit = access >= 2
      ? html` data-pid="${page.id}" data-lang="${ctx.lang}" data-title="${title}"${
        (await page.files()).has("share") ? html.raw(" data-share") : ""}` : "";
    return html.async`<tr${edit}>
  ${lead(html.async`<a href="${page.url()}">${title}</a>${page.vs.searchable ? "" : html.async`
      <small>(${t`not searchable`})</small>`}`)}
  ${field(t, seoTitle, 10, 55)}
  ${field(t, descr, 60, 156)}
  ${field(t, await text(page, "_share_title"))}
  ${field(t, await text(page, "_share_description"))}
  <td>${file ? html`<img src="${await imageUrl(file, 240, 126)}" alt="">` : ""}`;
  }, { type: "p", readable: true });
}

type Args = { ctx: Ctx; vars?: Record<string, unknown> };
const render = (node: Node, args: Args) => node.app.t.with("cms.seo", () => renderTree(node, args));
const list = (node: Node, args: Args) => node.app.t.with("cms.seo", () => listRows(node, args));

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
