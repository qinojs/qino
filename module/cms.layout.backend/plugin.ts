import { html, moduleIcon, type Ctx, type HtmlString } from "../core/mod.ts";
import * as u2 from "../u2/mod.ts";
import type { Node } from "../cms/mod.ts";

async function render(node: Node, {ctx}: { ctx: Ctx }): Promise<HtmlString> {

  const app = node.app;
  const resHtml = ctx.res.html;
  
  resHtml.class.add("qgCMS");
  resHtml.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");

  await u2.assets(ctx, [
    "css/norm/norm.css",
    "css/base/base.css",
    "css/classless/variables.css",
    "css/classless/classless.css",
    "css/classless/more.css",
    "class/flex/flex.css",
    "class/grid/grid.css",
    "class/unstyle/unstyle.css",
    "class/card/card.css",
    "class/table/table.css",
    "class/badge/badge.css",
    "el/breadcrumb/breadcrumb.css",
    "el/bytes/bytes.css",
    "el/buttongroup/buttongroup.css",
    "el/accordion/accordion.css",
    "el/ico/ico.css",
    "el/tabs/tabs.css",
    "el/code/code.css",
    "el/menubutton/menubutton.css",
    "el/tree/tree.css",
    // "el/ico/ico.js",
    // "el/breadcrumb/breadcrumb.js",
    // "attr/href/href.js",
    // "el/time/time.js",
    // "attr/confirm/confirm.js",
    // "el/buttongroup/buttongroup.js",
    // "el/accordion/accordion.js",
    // "el/tabs/tabs.js",
    // "el/code/code.js",
    // "el/bytes/bytes.js",
    // "attr/movable/movable.js",
    // "el/menubutton/menubutton.js",
    "u2/auto.js", // fetches what the markup needs, instead of the list above
  ]);

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
    const out = [];
    for (const child of nodes) {
      const active = await page.in(child);
      const subs = level < 3 ? [...(await child.children({ access: 1 })).values()] : [];
      const sub = active && subs.length ? await nav(subs, level + 1) : "";
      const mod = level === 1 ? app.modules.get(String((await child.conts())[0]?.vs?.module ?? "")) : undefined;
      const use = moduleIcon(mod);
      const icon = use ? html`<svg width=24 height=24 style="flex-shrink:0; height:1.3em; vertical-align:-23.8%">${use}</svg> ` : "";
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
    const links = [];
    const u = ctx.req.url.toURL();
    for (const l of allLangs) {
      if (l === currentLang) continue;
      u.searchParams.set("lang", l);
      links.push(html`<a href="${u.pathname + u.search}">${l}</a> `);
    }
    langHtml = html`<li><span class=-item style="padding:.375rem 1rem; text-align:right">${links}</span>`;
  }

  // Content conts
  const contentHtml = [];
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
        ${ctx.user ? ctx.user.email : "Guest"}
      </div>
    </div>
    <div id=content>
      ${contentHtml}
    </div>
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
