import { html } from "@qino/qino";
import * as identity from "@qino/qino/identity";
import * as u2 from "@qino/qino/u2";

import type { HtmlString, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Pinned on purpose: this layout's css is written against it, so a newer u2 elsewhere cannot change its look.
const U2_VERSION = "1.4.6";

const LOGO_HEIGHT = 48; // display height, must match #logo img in main.css

const U2_CSS = [
  "css/norm/norm.css",
  "css/base/base.css",
  "css/classless/variables.css", // color system: derives the palette from --color
  "css/classless/classless.css", // typography for content
  "css/classless/more.css",
  "class/width/width.css",
  "class/flex/flex.css",
  "class/unstyle/unstyle.css",
  "el/ico/ico.css",
  "u2/auto.js", // fetches what the markup needs — droppable once the design is settled
];

// Frontend layout built on the u2 framework: header (logo + nav), main, footer.
// Global conts (nav, foot) live on a shared layout page; only `main` is per-page.
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  await u2.assets(ctx, U2_CSS, U2_VERSION);
  ctx.res.html.inlineStyles.add(await u2.identityCss(node.app));
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");

  const layoutPage = await node.cms.layoutPage(String(node.vs.module));

  // Logo: the identity image if uploaded, otherwise the portal name (or the host).
  // Delivered at twice the display height — the transform scales it down, svg passes through untouched.
  const brand = String(await node.app.settings.identity.name ?? "") || (ctx.req.header("host") ?? "");
  const logo = await identity.file(node.app, "logo");
  const logoInner = logo ? html`<img src="${await logo.url({ h: LOGO_HEIGHT * 2 })}" alt="${brand}" height=${LOGO_HEIGHT}>` : brand;

  return html.async`<div id=container>
  <header id=head role=banner>
    <div class=u2-width>
      <div class="u2-flex -Between">
        <a id=logo href="${ctx.req.appUrl}">${logoInner}</a>
        <input type=checkbox id=navtoggle hidden>
        <label for=navtoggle id=burger aria-label=Menu>
          <svg viewBox="0 0 24 24" width=28 height=28 fill=none stroke=currentColor stroke-width=2 stroke-linecap=round>
            <g class=-menu><path d="M3 6h18M3 12h18M3 18h18"/></g>
            <g class=-close><path d="M5 5l14 14M5 19L19 5"/></g>
          </svg>
        </label>
        <div id=nav>${layoutPage.cont("nav", "cms.cont.nav3")}</div>
      </div>
    </div>
  </header>
  <main id=content>
    <div class=u2-width>${node.cont("main")}</div>
  </main>
  <footer id=foot role=contentinfo>
    <div class=u2-width>${layoutPage.cont("foot")}</div>
  </footer>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
