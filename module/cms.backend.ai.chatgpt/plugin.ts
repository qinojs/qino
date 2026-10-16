import { html } from "@qino/qino";
import { connections } from "@qino/qino/ai.chatgpt";
import { backend } from "@qino/qino/cms.backend";
import { render as account } from "@qino/qino/cms.cont.my.chatgpt";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, manifest.name, { en: "ChatGPT plan", de: "ChatGPT-Abo" });
}

/**
 * The own ChatGPT account, and whose plan answers when no one is signed in (ai.chatgpt's `usr`):
 * cron, background work, visitors. Everyone can offer only their own plan, with an account
 * connected; taking it back is up to them or a superuser.
 */
async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }) {
  const app = node.app, t = app.t, me = ctx.userId, settings = app.settings["ai.chatgpt"];
  const connected = me ? (await connections(app, me)).some((a) => a.active) : false;
  if (vars.fallback === "mine" && connected) await settings.usr(me);
  if (vars.fallback === "none" && (Number(await settings.usr) === me || ctx.user?.superuser)) await settings.usr(0);

  const usr = Number(await settings.usr) || 0;
  const name = usr ? String(await app.db.one`SELECT username FROM usr WHERE id = ${usr}` ?? `#${usr}`) : "";
  const button = (value: string, label: unknown) =>
    html.async`<form method=post>${node.cms.formFields(node)}<button name=fallback value=${value}>${label}</button></form>`;

  return html.async`<div class=u2-flex>
    <div class=u2-card>
      <div class=-head>${t`Your ChatGPT account`}</div>
      ${account(node, { ctx })}
    </div>
    <div class=u2-card>
      <div class=-head>${t`When no one is signed in`}</div>
      <div>
        <p>${t`Cron, background work and visitors without a login can use the plan of one user.`}</p>
        <p>${usr ? html.async`${t`Now the plan of`} <strong>${usr === me ? t`you` : name}</strong> ${t`answers.`}` : t`No plan answers; such work goes to other models.`}</p>
        ${usr === me ? button("none", t`Stop using my plan for this`)
          : connected ? button("mine", t`Use my plan for this`)
          : html.async`<p><small>${t`Connect a ChatGPT account to offer your plan.`}</small></p>`}
        ${usr && usr !== me && ctx.user?.superuser ? button("none", t`Stop using this plan`) : ""}
      </div>
    </div>
  </div>`;
}

export const cms = { node: { render } };
