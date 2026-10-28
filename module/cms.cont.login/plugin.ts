import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["class/card/card.css", "class/flex/flex.css"]);
  const app = node.app;
  const t = app.t;
  const edit = await node.edit();
  // signed in, the password form renders nothing but still applies its redirect setting
  if (ctx.user && !edit) return html.async`<div class=u2-card>
    ${node.cont("password", "cms.cont.login.password")}
    <div>${node.cont("logout", "cms.cont.logout")}</div>
  </div>`;

  const reset = await node.cms.nodeByModule("cms.cont.password_reset");
  return html.async`<div class=u2-card>
    <header>
      <h2>${t`Sign in`}</h2>
      <p>${t`Welcome back`}</p>
    </header>
    ${node.cont("known", "cms.cont.login.known")}
    ${node.cont("password", "cms.cont.login.password")}
    ${reset ? html.async`<a href="${await reset.url()}">${t`Forgot your password?`}</a>` : ""}
    <div class=-or>${t`or`}</div>
    ${node.cont("passkey", "cms.cont.login.webauthn")}
    <div class="-providers u2-flex">${node.cont("oauth", "cms.cont.login.oauth")}</div>
    ${edit ? node.cont("logout", "cms.cont.logout") : ""}
  </div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
