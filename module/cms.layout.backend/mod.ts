/**
 * cms.layout.backend/mod.ts
 * Port of cms.layout.backend/index.php
 */

// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { RequestContext } from "../core/lib/context.ts";

export const name = "cms.layout.backend";

const u2Root = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.2.0/";

async function render(node: Node, {ctx}: { ctx: RequestContext }): Promise<string> {

  const app = node.app;

  ctx.html.addJSFile(ctx.sysURL + "core/js/jQuery.js");
  ctx.html.addJSFile(ctx.sysURL + "core/js/c1.js");
  ctx.html.addJSFile(ctx.sysURL + "core/js/c1/dom.js");
  ctx.html.addJSFile(ctx.sysURL + "core/js/c1/onElement.js");
  ctx.html.addJSFile(ctx.sysURL + "core/js/qg.js");
  ctx.html.addJSM(ctx.sysURL + "cms/pub/js/cms.mjs");
  //ctx.html.addJSFile(ctx.sysURL + "core/js/c1/loading.js");

  ctx.html.addCSSFile(u2Root + "css/norm/norm.css");
  ctx.html.addCSSFile(u2Root + "css/base/base.css");
  ctx.html.addCSSFile(u2Root + "css/classless/variables.css");
  ctx.html.addCSSFile(u2Root + "css/classless/classless.css");
  ctx.html.addCSSFile(ctx.sysURL + "core/js/c1/css/theme1.css");
  ctx.html.addCSSFile(ctx.sysURL + "core/css/c1/box.css");
  ctx.html.addCSSFile(ctx.sysURL + "cms.frontend.1/pub/css/main.css");

  ctx.html.meta["viewport"] = "width=device-width";

  const Page = await node.page();

  // Create default cont if none exists
  const conts = await node.conts();
  if (!conts.length) await node.cont("main");

  // Nav: get backend root page and its children
  const backendId = parseInt(String(await app.settings.cms.backend ?? "0"));
  const BackendRoot = backendId ? await app.cms.node(backendId) : null;
  const navItems = BackendRoot ? [...(await BackendRoot.children({ access: 1 })).values()] : [];

  let navHtml = "";
  for (const C of navItems as any[]) {
    const subC = [...(await C.children({ access: 1 })).values()] as any[];
    const isActive = await Page.in(C);
    const hasSub = subC.length > 0;
    const cUrl = hee(await C.url());
    const cTitle = hee(await (await C.title()).string());
    let subHtml = "";
    if (isActive) {
      for (const SC of subC) {
        const subSC = [...(await SC.children({ access: 1 })).values()] as any[];
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
    navHtml += `<li><a class="-item ${isActive ? "-active" : ""} ${hasSub ? "-hasSub" : ""}" href="${cUrl}">${cTitle}</a>${subHtml}`;
  }

  // Language switcher
  const allLangs = app.languages.all;
  let langHtml = "";
  if (allLangs.length > 1) {
    const currentLang = ctx.lang;
    let links = "";
    for (const l of allLangs) {
      if (l === currentLang) continue;
      const uri = ctx.server.REQUEST_URI;
      const sep = uri.includes("?") ? "&amp;" : "?";
      links += `<a href="${hee(uri + sep + "changeLanguage=" + encodeURIComponent(l))}">${hee(l)}</a> `;
    }
    langHtml = `<li><span class=-item style="padding:6px 16px; text-align:right">${links}</span>`;
  }

  // Content conts
  const allConts = await node.conts();
  let contentHtml = "";
  for (const C of allConts) {
    contentHtml += await C.html();
  }

  return `
  <div class=qgCMS id=container>
    <nav id=nav>
      <ul>
        ${navHtml}
        ${langHtml}
      </ul>
    </nav>
    <div id=content>
    ${contentHtml}
    </div>
  </div>`;
}

export const cms = {
  node: {
    render,
  },
};
