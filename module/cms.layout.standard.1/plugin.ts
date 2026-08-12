import type { Node } from "../cms/mod.ts";
import type { Ctx } from "../core/mod.ts";
import { layoutOptions, moduleTemplate } from "../cms.templateParser/mod.ts";
import * as identity from "../identity/mod.ts";

// Pinned here on purpose: this layout's look must stay stable even if core bumps u2.
const U2_ROOT = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.4.6/";

const U2_CSS = [
  "css/norm/norm.css",
  "css/base/base.css",
  "css/classless/variables.css", // color system: derives the palette from --color
  "css/classless/classless.css", // typography for content
  "css/classless/more.css",
  "class/width/width.css",
  "class/flex/flex.css",
];

// The knobs of the layout, all commented out: color and font come from the identity module until the site sets them here.
const INITIAL_CSS = `/* Styles of this site, linked while this file exists. */
html {
  /* --color: #fa349a; */ /* u2 derives the whole palette from it */
  /* --font-1: system-ui, sans-serif; */
  /* --width: 50rem; */ /* width of header, content and footer */
  /* --radius: .3rem; */
}
#container { /* nesting syntax */
  #head {
  }
  #content {
  }
  #foot {
  }
}
`;

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  const template = moduleTemplate(node.module!);
  if (node.edit) await template.create(INITIAL_CSS);

  await identity.css(ctx);

  ctx.res.csp["style-src"][U2_ROOT] = true;
  ctx.res.csp["script-src"][U2_ROOT] = true;
  ctx.res.csp["connect-src"][U2_ROOT] = true;
  for (const f of U2_CSS) ctx.res.html.styles.add(U2_ROOT + f);
  ctx.res.html.scripts.add(U2_ROOT + "u2/auto.js");

  return template.render(node);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    options: layoutOptions,
  },
};
