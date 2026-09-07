import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "URLs", de: "URLs" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const admin = ctx.settings.cms.admin;
  if (ctx.req.query.rp) {
    const root = await node.cms.node(Number(ctx.req.query.rp));
    if (root.exists() && await root.access() > 0) admin.rootPageNode(root.id);
  }

  const root = await node.cms.node(Number(admin.rootPageNode()) || 1);
  const path: HtmlString[] = [];
  for (const page of (await root.path()).values()) {
    const title = await pageTitle(page, ctx.lang);
    path.push(html`<a href="${"?rp=" + page.id}">${String(title).trim() || "(no text)"}</a> > `);
  }

  const langs = node.app.languages.all;
  const head = html.join(langs.map((lang) => html`<th>${lang}`));
  return html.async`<div class=u2-card style="flex:0 1 auto">
  <div class=-head>${node.app.t`URLs`}</div>
  <div>
    <label><input type=checkbox data-toggle-contents${admin.showContents() ? " checked" : ""}> ${node.app.t`Show contents`}</label>
    <div>${path}</div>
  </div>
  <table class="u2-table cmsBeTree">
    <thead><tr>
      <th style="width:1.25rem">${node.app.t`No.`}
      <th style="min-width:15.625rem">${node.app.t`Page`}
      ${head}
    <tbody cms-part=list>${await list(node, { ctx })}
  </table>
</div>`;
}

async function list(node: Node, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const admin = ctx.settings.cms.admin;
  if (vars?.showContents != null) admin.showContents(vars.showContents == "1");
  const type = admin.showContents() ? "*" : "p";
  const open = new Set(String(admin.openPageNodes() ?? "").split(",").filter(Boolean));
  if (vars?.toggleOpen != null) {
    const id = String(vars.toggleOpen);
    vars.value == "1" ? open.add(id) : open.delete(id);
    admin.openPageNodes([...open].join(","));
  }

  const root = await node.cms.node(Number(admin.rootPageNode()) || 1);
  const langs = node.app.languages.all;
  const rows: HtmlString[] = [];
  await addChildren(root, 0);
  return html.join(rows);

  async function addChildren(parent: Node, level: number): Promise<void> {
    for (const page of (await parent.children({ type })).values()) {
      const access = await page.access(ctx.user);
      const hasChildren = (await page.children({ type })).size > 0;
      const isOpen = open.has(String(page.id));
      const title = access > 0
        ? html`<span style="flex:1">${await pageTitle(page, ctx.lang)}</span><a style="vertical-align:middle" href="${await page.url()}" title=open><u2-ico icon=open_in_new>↗</u2-ico></a>`
        : html`<span style="flex:1; color:#bbb">(${await node.app.t`no access`})</span>`;
      const toggle = hasChildren
        ? html`<button class="u2-unstyle -toggle" data-toggle-id="${page.id}" data-toggle-value="${isOpen ? 0 : 1}"><u2-ico icon="${isOpen ? "remove" : "add"}">${isOpen ? "−" : "+"}</u2-ico></button>`
        : html`<span class=-toggle></span>`;
      const urls: HtmlString[] = [];
      const custom = new Set(access >= 2
        ? (await node.app.db.query`SELECT lang FROM page_url WHERE page_id = ${page.id} AND custom = ${true}`).map(row => row.lang)
        : []);
      for (const lang of langs) {
        const url = access > 0 ? await page.urlSeo(lang) : "---";
        urls.push(html`<td>${access < 2 ? url : await html.async`<div data-pid="${page.id}" data-lang="${lang}">
          <input name=url value="${url}" aria-label="${lang}">
          <input type=checkbox name=auto title="${node.app.t`Automatic`}"${custom.has(lang) ? "" : " checked"}>
          <output></output>
        </div>`}`);
      }

      rows.push(html`<tr${page.vs.type === "c" ? html.raw(" class=-isCont") : ""}>
  <td style="text-align:right; font-weight:bold">
    <a title="${await node.app.t`Set as start point`}" href="${"?rp=" + page.id}">${page.id}</a>
  <td style="padding-left:${level * .9375}rem"><div style="display:flex; align-items:center">${toggle}${title}</div>
  ${urls}`);
      if (isOpen) await addChildren(page, level + 1);
    }
  }
}

async function pageTitle(page: Node, lang: string): Promise<string> {
  const title = await page.title();
  return (title && await (await title.orFallback(lang)).get()) || "(no text)";
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
