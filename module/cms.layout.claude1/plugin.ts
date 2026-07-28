import { html, type HtmlString, type Ctx } from "../core/mod.ts";
import type { CMS, Node } from "../cms/mod.ts";

export const name = "cms.layout.claude1";

// Pinned here on purpose: this layout's look must stay stable even if core bumps u2.
const u2Root = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.4.1/";

const u2css = [
  "css/norm/norm.css",
  "css/base/base.css",
  "css/classless/variables.css", // color system: derives the palette from --color
  "css/classless/classless.css", // typography for content
  "css/classless/more.css",
  "class/width/width.css",
  "class/flex/flex.css",
  "class/unstyle/unstyle.css",
  "el/ico/ico.css",
];

const settingsSchema = {
  properties: {
    color: { type: "string", format: "color", description: "Brand color. u2 derives the whole palette from it." },
    accent: { type: "string", format: "color", description: "Accent color for highlights (logo, active nav). Defaults to the brand color." },
    logo: { type: "string", format: "uri", description: "Logo image URL. Falls back to the text below if empty." },
    logoText: { type: "string", description: "Logo text, shown when no logo image is set. Defaults to the host name." },
  },
};

// Frontend layout built on the u2 framework: header (logo + nav), main, footer.
// Global conts (nav, foot) live on a shared layout page; only `main` is per-page.
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.csp["style-src"][u2Root] = true;
  ctx.res.csp["script-src"][u2Root] = true;
  ctx.res.csp["connect-src"][u2Root] = true;

  for (const f of u2css) ctx.res.html.styles.add(u2Root + f);
  ctx.res.html.scripts.add(u2Root + "u2/auto.js");
  ctx.res.html.legacyScripts.add(ctx.req.modulePath + "core/pub/js/c1.js");
  ctx.res.html.scripts.add(ctx.req.modulePath + "cms/pub/js/cms.mjs");

  const layoutPage = await getLayoutPage(node.cms, String(node.vs.module));

  // Colors from settings override the CSS defaults; u2 derives the palettes.
  const color = layoutPage.settings.color();
  const accent = layoutPage.settings.accent();
  const decls = [color && `--color:${color}`, accent && `--accent:${accent}`].filter(Boolean);
  const skin = decls.length ? html` style="${decls.join(";")}"` : "";

  // Logo: image if set, otherwise text (custom or host name).
  const logo = String(layoutPage.settings.logo() ?? "");
  const brand = String(layoutPage.settings.logoText() ?? "") || (ctx.req.header("host") ?? "");
  const logoInner = logo ? html`<img src="${logo}" alt="${brand}" height=32>` : brand;

  return html.async`<div id=container u2-skin${skin}>
  <header id=head role=banner>
    <div class=u2-width>
      <div class="u2-flex -Between">
        <a id=logo href="${ctx.req.basePath}">${logoInner}</a>
        <input type=checkbox id=navtoggle hidden>
        <label for=navtoggle id=burger aria-label="Menu">
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

// Shared layout page (child of sys page 5), one per layout module, holds global conts.
async function getLayoutPage(cms: CMS, module: string): Promise<Node> {
  const sysPage = await cms.node(5);
  const children = await sysPage.children({ module });
  let layoutPage = children.values().next().value;
  if (!layoutPage) {
    layoutPage = await sysPage.createChild({ module, name: module, access: 1 });
    await layoutPage.title(undefined, module);
  }
  return layoutPage;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    settingsSchema,
  },
};
