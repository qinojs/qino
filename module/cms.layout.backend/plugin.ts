import { html, u2Root, type Ctx, type HtmlString } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.layout.backend";
export const description = "Renders the CMS administration layout and navigation.";

async function render(node: Node, {ctx}: { ctx: Ctx }): Promise<HtmlString> {

  const app = node.app;
  const resHtml = ctx.res.html;
  
  resHtml.class.add("qgCMS");
  resHtml.legacyScripts.add(ctx.req.moduleUrl + "core/pub/js/c1.js");
  resHtml.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");

  ctx.res.csp["style-src"][u2Root] = true;
  ctx.res.csp["script-src"][u2Root] = true;
  ctx.res.csp["connect-src"][u2Root] = true;

  resHtml.styles.add(u2Root + "css/norm/norm.css");
  resHtml.styles.add(u2Root + "css/base/base.css");
  resHtml.styles.add(u2Root + "css/classless/variables.css");
  resHtml.styles.add(u2Root + "css/classless/classless.css");
  resHtml.styles.add(u2Root + "css/classless/more.css");
  resHtml.styles.add(u2Root + "class/flex/flex.css");
  resHtml.styles.add(u2Root + "class/grid/grid.css");
  resHtml.styles.add(u2Root + "class/unstyle/unstyle.css");
  resHtml.styles.add(u2Root + "class/card/card.css");
  resHtml.styles.add(u2Root + "class/table/table.css");
  resHtml.styles.add(u2Root + "class/badge/badge.css");
  resHtml.styles.add(u2Root + "el/breadcrumb/breadcrumb.css");
  resHtml.styles.add(u2Root + "el/bytes/bytes.css");
  resHtml.styles.add(u2Root + "el/buttongroup/buttongroup.css");
  resHtml.styles.add(u2Root + "el/accordion/accordion.css");
  resHtml.styles.add(u2Root + "el/ico/ico.css");
  resHtml.styles.add(u2Root + "el/tabs/tabs.css");
  resHtml.styles.add(u2Root + "el/code/code.css");
  resHtml.styles.add(u2Root + "el/menubutton/menubutton.css");
  resHtml.styles.add(u2Root + "el/tree/tree.css");
  // html.scripts.add(u2Root + "el/ico/ico.js");
  // html.scripts.add(u2Root + "el/breadcrumb/breadcrumb.js");
  // html.scripts.add(u2Root + "attr/href/href.js");
  // html.scripts.add(u2Root + "el/time/time.js");
  // html.scripts.add(u2Root + "attr/confirm/confirm.js");
  // html.scripts.add(u2Root + "el/buttongroup/buttongroup.js");
  // html.scripts.add(u2Root + "el/accordion/accordion.js");
  // html.scripts.add(u2Root + "el/tabs/tabs.js");
  // html.scripts.add(u2Root + "el/code/code.js");
  // html.scripts.add(u2Root + "el/bytes/bytes.js");
  // html.scripts.add(u2Root + "attr/movable/movable.js");
  // html.scripts.add(u2Root + "el/menubutton/menubutton.js");
  resHtml.scripts.add(u2Root + "u2/auto.js");

  resHtml.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");

  const page = await node.page();

  // Create default cont if none exists
  const conts = await node.conts();
  if (!conts.length) await node.cont("main");

  // Nav: get backend root page and its children
  const backendId = Number(await app.settings.cms.backend ?? "0");
  const backendRoot = backendId ? await node.cms.node(backendId) : null;
  const navItems = backendRoot ? [...(await backendRoot.children({ access: 1 })).values()] : [];

  /** Nav levels 1-3; only the active branch expands, only level 1 shows the module icon. */
  async function nav(nodes: Node[], level: number): Promise<HtmlString> {
    const out: HtmlString[] = [];
    for (const child of nodes) {
      const active = await page.in(child);
      const subs = level < 3 ? [...(await child.children({ access: 1 })).values()] : [];
      const sub = active && subs.length ? await nav(subs, level + 1) : "";
      const mod = level === 1 ? String((await child.conts())[0]?.vs?.module ?? "") : "";
      const icon = mod ? html`<svg width=24 height=24 style="flex-shrink:0; height:1.3em; vertical-align:-23.8%"><use href="${ctx.req.moduleUrl + mod}/pub/module.svg#main"/></svg> ` : "";
      const item = html`<li><a class="-item ${active ? "-active" : ""} ${subs.length ? "-hasSub" : ""}" href="${await child.url()}">${icon}${await (await child.title()).string()}</a>${sub}`;
      out.push(level === 1 ? item : html`<ul>${item}</ul>`);
    }
    return html.join(out);
  }
  const navHtml = await nav(navItems, 1);

  // Language switcher
  const allLangs = app.languages.all;
  let langHtml: HtmlString | string = "";
  if (allLangs.length > 1) {
    const currentLang = ctx.lang;
    const links: HtmlString[] = [];
    const u = ctx.req.url.toURL();
    for (const l of allLangs) {
      if (l === currentLang) continue;
      u.searchParams.set("lang", l);
      links.push(html`<a href="${u.pathname + u.search}">${l}</a> `);
    }
    langHtml = html`<li><span class=-item style="padding:.375rem 1rem; text-align:right">${html.join(links)}</span>`;
  }

  // Content conts
  const contentHtml: HtmlString[] = [];
  for (const child of await node.conts()) contentHtml.push(await child.html());

  const pathHtml = html.join(await Promise.all([...await page.path()].filter(([id]) => id !== 1).map(([, p]) => node.cms.link(p))));

  return html`
  <div class=qgCMS id=container>
    <a id=logo href="${backendRoot ? await backendRoot.url() : "/"}">
      <svg viewBox="0 0 90 30">
        <text x=0 y=24 font-family="system-ui,sans-serif" font-weight=900 font-size=26 fill=currentColor letter-spacing=-1>q<tspan opacity=".4">i</tspan>no</text>
      </svg>
    </a>
    <nav id=nav>
      <ul>
        ${navHtml}
        ${langHtml}
      </ul>
    </nav>
    <div id=toolbar class=u2-flex>
      <u2-breadcrumb>${pathHtml}</u2-breadcrumb>
      <!--input type=search id=search placeholder="Search..." style="width:100%; max-width:20rem; background:var(--color-light); border:0; border-radius: var(--radius);"-->
      <div style="margin-left:auto" shape=circle size=32>
        ${ctx.user ? await ctx.user.get("email") : "Guest"}
      </div>
    </div>
    <div id=content>
      ${html.join(contentHtml)}
    </div>
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
