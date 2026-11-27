import { html } from "@qino/qino";
import * as identity from "@qino/qino/identity";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Centered box with the logo and the page title, in the site's identity. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app;
  u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css", "css/classless/variables.css", "css/classless/classless.css", "u2/auto.js"]);
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.js");

  // the look is a nicety: without identity the page still stands
  const [css, logo, name] = await Promise.all([
    u2.identityCss(app).catch(() => ""),
    identity.file(app, "logo").then((file) => file?.url({ h: 80 })).catch(() => undefined),
    app.settings.identity.name,
  ]);
  if (css) ctx.res.html.inlineStyles.add(css);

  return html.async`
  <main id=container>
    ${logo ? html`<a href="${ctx.req.appUrl}"><img src="${logo}" alt="${name}"></a>` : ""}
    <h1>${(await node.title()).string()}</h1>
    ${node.cont("main")}
  </main>`;
}

export const cms = {
  node: {
    css: [
      "pub/main.css",
    ],
    render,
  },
};
