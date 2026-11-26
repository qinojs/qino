import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { breadcrumb, pageTitle, walk } from "@qino/qino/cms.backend.cms.tree";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "URLs", de: "URLs" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  const admin = ctx.settings.cms.admin;
  const path = await breadcrumb(node, ctx);

  const langs = node.app.languages.all;
  const head = html.join(langs.map((lang) => html`<th>${lang}`));
  return html.async`<div class=u2-card style="flex:0 1 auto">
  <div class=-head>${t`URLs`}</div>
  <div>
    <label><input type=checkbox data-toggle-contents${admin.showContents() ? " checked" : ""}> ${t`Show contents`}</label>
    <div>${path}</div>
  </div>
  <table class="u2-table cmsBeTree">
    <thead><tr>
      <th style="width:1.25rem">${t`No.`}
      <th style="min-width:15.625rem">${t`Page`}
      ${head}
    <tbody cms-part=list>${list(node, { ctx })}
  </table>
</div>`;
}

function list(node: Node, args: { ctx: Ctx; vars?: Record<string, unknown> }) {
  const t = node.app.t, ctx = args.ctx, langs = node.app.languages.all;
  return walk(node, args, async ({ page, access, lead }) => {
    const title = access > 0
      ? html.async`<span style="flex:1">${pageTitle(page, ctx.lang)}</span><a style="vertical-align:middle" href="${page.url()}" title=open><u2-ico icon=open_in_new>↗</u2-ico></a>`
      : html.async`<span style="flex:1; color:#bbb">(${t`no access`})</span>`;
    const custom = new Set(access >= 2
      ? await node.app.db.col<string>`SELECT lang FROM page_url WHERE page_id = ${page.id} AND custom = ${true}`
      : []);
    const urls = langs.map((lang) => {
      const url = access > 0 ? page.urlSeo(lang) : "---";
      return html.async`<td>${access < 2 ? url : html.async`<div data-pid="${page.id}" data-lang="${lang}">
          <input name=url value="${url}" aria-label="${lang}">
          <input type=checkbox name=auto title="${t`Automatic`}"${custom.has(lang) ? "" : " checked"}>
          <output></output>
        </div>`}`;
    });
    return html.async`<tr${page.vs.type === "c" ? html.raw(" class=-isCont") : ""}>
  ${lead(title)}
  ${urls}`;
  });
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
