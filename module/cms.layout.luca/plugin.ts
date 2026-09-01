import { layoutOptions, moduleTemplate } from "@qino/qino/cms.templateParser";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Pinned on purpose: this layout's css is written against it, so a newer u2 elsewhere cannot change its look.
const U2_VERSION = "1.4.6";

const U2_CSS = [
  "css/norm/norm.css",
  "css/base/base.css",
  "css/classless/variables.css", // color system: derives the palette from --color
  "css/classless/classless.css", // typography for content
  "class/width/width.css", // .u2-width — the layout's own measure
  "class/grid/grid.css",
  "u2/auto.js", // fetches what the markup needs — droppable once the design is settled
];

// The knobs of the layout, all commented out: color and font come from the identity module until the site sets them here.
const INITIAL_CSS = `/* Styles of this site, linked while this file exists. */
html {
  /* --color: #1a1714; */ /* u2 derives the whole palette from it */
  /* --font-1: system-ui, sans-serif; */
  /* --width: 68rem; */ /* measure of header, content and footer */
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

  await u2.assets(ctx, U2_CSS, U2_VERSION);
  ctx.res.html.inlineStyles.add(await u2.identityCss(node.app));

  return template.render(node);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    options: layoutOptions,
  },
};
