import { hee, u2Root, type Ctx } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.layout.backend";

async function render(node: Node, {ctx}: { ctx: Ctx }): Promise<string> {

  const app = node.app;
  const html = ctx.res.html;
  
  html.class.add("qgCMS");
  html.legacyScripts.add(ctx.req.modulePath + "core/pub/js/c1.js");
  html.scripts.add(ctx.req.modulePath + "cms/pub/js/cms.mjs");

  ctx.res.csp["style-src"][u2Root] = true;
  ctx.res.csp["script-src"][u2Root] = true;
  ctx.res.csp["connect-src"][u2Root] = true;

  html.styles.add(u2Root + "css/norm/norm.css");
  html.styles.add(u2Root + "css/base/base.css");
  html.styles.add(u2Root + "css/classless/variables.css");
  html.styles.add(u2Root + "css/classless/classless.css");
  html.styles.add(u2Root + "css/classless/more.css");
  html.styles.add(u2Root + "class/flex/flex.css");
  html.styles.add(u2Root + "class/grid/grid.css");
  html.styles.add(u2Root + "class/unstyle/unstyle.css");
  html.styles.add(u2Root + "class/card/card.css");
  html.styles.add(u2Root + "class/table/table.css");
  html.styles.add(u2Root + "class/badge/badge.css");
  html.styles.add(u2Root + "el/breadcrumb/breadcrumb.css");
  html.styles.add(u2Root + "el/bytes/bytes.css");
  html.styles.add(u2Root + "el/buttongroup/buttongroup.css");
  html.styles.add(u2Root + "el/accordion/accordion.css");
  html.styles.add(u2Root + "el/ico/ico.css");
  html.styles.add(u2Root + "el/tabs/tabs.css");
  html.styles.add(u2Root + "el/code/code.css");
  html.styles.add(u2Root + "el/menubutton/menubutton.css");
  html.styles.add(u2Root + "el/tree/tree.css");
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
  html.scripts.add(u2Root + "u2/auto.js");

  html.styles.add(ctx.req.modulePath + "cms/pub/css/ui.css");

  const page = await node.page();

  // Create default cont if none exists
  const conts = await node.conts();
  if (!conts.length) await node.cont("main");

  // Nav: get backend root page and its children
  const backendId = Number(await app.settings.cms.backend ?? "0");
  const backendRoot = backendId ? await node.cms.node(backendId) : null;
  const navItems = backendRoot ? [...(await backendRoot.children({ access: 1 })).values()] : [];

  /** Nav levels 1-3; only the active branch expands, only level 1 shows the module icon. */
  async function nav(nodes: Node[], level: number): Promise<string> {
    let out = "";
    for (const child of nodes) {
      const active = await page.in(child);
      const subs = level < 3 ? [...(await child.children({ access: 1 })).values()] : [];
      const sub = active && subs.length ? await nav(subs, level + 1) : "";
      const mod = level === 1 ? String((await child.conts())[0]?.vs?.module ?? "") : "";
      const icon = mod ? `<svg width=24 height=24 style="flex-shrink:0; height:1.3em; vertical-align:-23.8%"><use href="${ctx.req.modulePath}${mod}/pub/module.svg#main"/></svg> ` : "";
      const item = `<li><a class="-item ${active ? "-active" : ""} ${subs.length ? "-hasSub" : ""}" href="${hee(await child.url())}">${icon}${hee(await (await child.title()).string())}</a>${sub}`;
      out += level === 1 ? item : `<ul>${item}</ul>`;
    }
    return out;
  }
  const navHtml = await nav(navItems, 1);

  // Language switcher
  const allLangs = app.languages.all;
  let langHtml = "";
  if (allLangs.length > 1) {
    const currentLang = ctx.lang;
    let links = "";
    const u = ctx.req.url.toURL();
    for (const l of allLangs) {
      if (l === currentLang) continue;
      u.searchParams.set("lang", l);
      links += `<a href="${hee(u.pathname + u.search)}">${hee(l)}</a> `;
    }
    langHtml = `<li><span class=-item style="padding:.375rem 1rem; text-align:right">${links}</span>`;
  }

  // Content conts
  let contentHtml = "";
  for (const child of await node.conts()) {
    contentHtml += await child.html();
  }

  const pathHtml = (await Promise.all([...await page.path()].filter(([id]) => id !== 1).map(([, p]) => node.cms.link(p)))).join("");

  return `
  <div class=qgCMS id=container>
    <a id=logo href="${backendRoot ? hee(await backendRoot.url()) : "/"}">
      <svg viewBox="0 0 90 30" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="24" font-family="system-ui,sans-serif" font-weight="900" font-size="26" fill="currentColor" letter-spacing="-1">q<tspan opacity=".4">i</tspan>no</text>
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
        ${ctx.user ? hee(await ctx.user.get("email")) : "Guest"}
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
