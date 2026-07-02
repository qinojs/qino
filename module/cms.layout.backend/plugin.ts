import { hee, u2Root, type RequestContext } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.layout.backend";

async function render(node: Node, {ctx}: { ctx: RequestContext }): Promise<string> {

  const app = node.app;
  const html = ctx.html;
  
  html.class.add("qgCMS");
  html.legacyScripts.add(ctx.sysURL + "core/pub/js/c1.js");
  html.scripts.add(ctx.sysURL + "cms/pub/js/cms.mjs");

  ctx.csp["style-src"][u2Root] = true;
  ctx.csp["script-src"][u2Root] = true;
  ctx.csp["connect-src"][u2Root] = true;

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

  html.styles.add(ctx.sysURL + "cms/pub/css/ui.css");

  const Page = await node.page();

  // Create default cont if none exists
  const conts = await node.conts();
  if (!conts.length) await node.cont("main");

  // Nav: get backend root page and its children
  const backendId = Number(await app.settings.cms.backend ?? "0");
  const BackendRoot = backendId ? await node.cms.node(backendId) : null;
  const navItems = BackendRoot ? [...(await BackendRoot.children({ access: 1 })).values()] : [];

  let navHtml = "";
  for (const C of navItems) {
    const subC = [...(await C.children({ access: 1 })).values()];
    const isActive = await Page.in(C);
    const hasSub = subC.length > 0;
    const cUrl = hee(await C.url());
    const cTitle = hee(await (await C.title()).string());
    let subHtml = "";
    if (isActive) {
      for (const SC of subC) {
        const subSC = [...(await SC.children({ access: 1 })).values()];
        const isActiveSC = await Page.in(SC);
        const hasSubSC = subSC.length > 0;
        const scUrl = hee(await SC.url());
        const scTitle = hee(await (await SC.title()).string());
        let subSubHtml = "";
        if (isActiveSC) {
          for (const SSC of subSC) {
            const sscUrl = hee(await SSC.url());
            const sscTitle = hee(await (await SSC.title()).string());
            const isActiveSSC = await Page.in(SSC);
            subSubHtml += `<ul><li><a class="-item ${isActiveSSC ? "-active" : ""}" href="${sscUrl}">${sscTitle}</a></ul>`;
          }
        }
        subHtml += `<ul><li><a class="-item ${isActiveSC ? "-active" : ""} ${hasSubSC ? "-hasSub" : ""}" href="${scUrl}">${scTitle}</a>${subSubHtml}</ul>`;
      }
    }
    const cConts = [...(await C.conts()).values()];
    const cModName = String(cConts[0]?.vs?.module ?? "");
    const cIcon = cModName ? `<svg width=24 height=24 style="flex-shrink:0; height:1.3em; vertical-align:-23.8%"><use href="${ctx.sysURL}${cModName}/pub/module.svg#main"/></svg> ` : "";
    navHtml += `<li><a class="-item ${isActive ? "-active" : ""} ${hasSub ? "-hasSub" : ""}" href="${cUrl}">${cIcon}${cTitle}</a>${subHtml}`;
  }

  // Language switcher
  const allLangs = app.languages.all;
  let langHtml = "";
  if (allLangs.length > 1) {
    const currentLang = ctx.lang;
    let links = "";
    const u = ctx.url;
    for (const l of allLangs) {
      if (l === currentLang) continue;
      u.searchParams.set("lang", l);
      links += `<a href="${hee(u.pathname + u.search)}">${hee(l)}</a> `;
    }
    langHtml = `<li><span class=-item style="padding:6px 16px; text-align:right">${links}</span>`;
  }

  // Content conts
  const allConts = await node.conts();
  let contentHtml = "";
  for (const C of allConts) {
    contentHtml += await C.html();
  }

  const pathHtml = (await Promise.all(Array.from(await Page.path()).filter(([id]) => id !== 1).map(([, p]) => node.cms.link(p)))).join("");

  return `
  <div class=qgCMS id=container>
    <a id=logo href="${BackendRoot ? hee(await BackendRoot.url()) : "/"}">
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
