import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const OLD = "cms.cont.login4"; // this module replaces it

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["class/card/card.css", "class/flex/flex.css"]);
  const app = node.app;
  const edit = await node.edit();
  // signed in, the password form renders nothing but still applies its redirect setting
  if (ctx.user && !edit) return html.async`<div class=u2-card>
    ${node.cont("password", "cms.cont.login.password")}
    <div>${node.cont("logout", "cms.cont.logout")}</div>
  </div>`;

  const reset = await node.cms.nodeByModule("cms.cont.password_reset");
  return html.async`<div class=u2-card>
    <header>
      <h2>${app.t`Sign in`}</h2>
      <p>${app.t`Welcome back`}</p>
    </header>
    ${node.cont("known", "cms.cont.login.known")}
    ${node.cont("password", "cms.cont.login.password")}
    ${reset ? html.async`<a href="${await reset.url()}">${app.t`Forgot your password?`}</a>` : ""}
    <div class=-or>${app.t`or`}</div>
    ${node.cont("passkey", "cms.cont.login.webauthn")}
    <div class="-providers u2-flex">${node.cont("oauth", "cms.cont.login.oauth")}</div>
    ${edit ? node.cont("logout", "cms.cont.logout") : ""}
  </div>`;
}

/** Take over the contents of the module this one replaces, and retire it. */
export async function install({ app }: { app: App }): Promise<void> {
  await app.db.exec`UPDATE page SET module = ${manifest.name} WHERE module = ${OLD}`;
  await app.modules.uninstall(OLD).catch(() => {});
}

export const cms = { node: { render, css: ["pub/main.css"] } };
