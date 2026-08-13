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
  "css/classless/more.css",
  "class/width/width.css",
  "class/flex/flex.css",
  "u2/auto.js", // fetches what the markup needs — droppable once the design is settled
];

// The knobs of the deck — a card gets its own look through its id, which cms puts on every content block.
const INITIAL_CSS = `/* Styles of this site, linked while this file exists. */
html {
  --color: #e73049; /* u2 derives the whole palette from it */
  /* --font-1: system-ui, sans-serif; */
  /* --width: 50rem; */ /* width of the content inside a card */
}
#container { /* nesting syntax */
  #head {
  }
  #content [qcms-id="0"] { /* one card: take its id from the page tree */
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
