import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { image, imageUrl, text } from "@qino/qino/cms.seo";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
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
  const admin = ctx.settings.cms.admin;
  if (ctx.req.query.rp) {
    const root = await node.cms.node(Number(ctx.req.query.rp));
    if (root.exists() && await root.access() > 0) admin.rootPageNode(root.id);
  }

  const root = await node.cms.node(Number(admin.rootPageNode()) || 1);
  const path: HtmlString[] = [];
  for (const page of (await root.path()).values())
    path.push(html`<a href="?rp=${page.id}">${await pageTitle(page, ctx.lang)}</a> > `);

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

async function listRows(node: Node, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }) {
  const admin = ctx.settings.cms.admin;
  const open = new Set(String(admin.openPageNodes() ?? "").split(",").filter(Boolean));
  if (vars?.toggleOpen != null) {
    const id = String(vars.toggleOpen);
    vars.value == "1" ? open.add(id) : open.delete(id);
    admin.openPageNodes([...open].join(","));
  }

  const root = await node.cms.node(Number(admin.rootPageNode()) || 1);
  const rows: Promise<HtmlString>[] = [];
  const t = node.app.t;
  await addChildren(root, 0);
  return html.async`${rows}`;

  async function addChildren(parent: Node, level: number) {
    for (const page of (await parent.children({ type: "p" })).values()) {
      const access = await page.access(ctx.user);
      if (!access) continue;
      const hasChildren = (await page.children({ type: "p" })).size > 0;
      const isOpen = open.has(String(page.id));
      const toggle = hasChildren
        ? html`<button class="u2-unstyle -toggle" data-toggle-id="${page.id}" data-toggle-value="${isOpen ? 0 : 1}">
          <u2-ico icon="${isOpen ? "remove" : "add"}">${isOpen ? "−" : "+"}</u2-ico></button>`
        : html`<span class=-toggle></span>`;
      const title = await pageTitle(page, ctx.lang);
      const file = await image(page);
      const seoTitle = await text(page, "_title") || title, descr = await text(page, "_description");
      // editable rows open the edit dialog on click
      const edit = access >= 2
        ? html` data-pid="${page.id}" data-lang="${ctx.lang}" data-title="${title}"${
          (await page.files()).has("share") ? html.raw(" data-share") : ""}` : "";
      rows.push(html.async`<tr${edit}>
  <td style="text-align:right; font-weight:bold">
    <a title="${t`Set as start point`}" href="?rp=${page.id}">${page.id}</a>
  <td style="padding-left:${level * .9375}rem"><div style="display:flex; align-items:center">${toggle}
    <a href="${page.url()}">${title}</a>${page.vs.searchable ? "" : html.async`
      <small>(${t`not searchable`})</small>`}</div>
  ${field(t, seoTitle, 10, 55)}
  ${field(t, descr, 60, 156)}
  ${field(t, await text(page, "_share_title"))}
  ${field(t, await text(page, "_share_description"))}
  <td>${file ? html`<img src="${await imageUrl(file, 240, 126)}" alt="">` : ""}`);
      if (isOpen) await addChildren(page, level + 1);
    }
  }
}

async function pageTitle(page: Node, lang: string): Promise<string> {
  const title = await page.title();
  return (title && await (await title.orFallback(lang)).get()) || "(no text)";
}

type Args = { ctx: Ctx; vars?: Record<string, unknown> };
const render = (node: Node, args: Args) => node.app.languages.with({ ns: "cms.seo" }, () => renderTree(node, args));
const list = (node: Node, args: Args) => node.app.languages.with({ ns: "cms.seo" }, () => listRows(node, args));

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
