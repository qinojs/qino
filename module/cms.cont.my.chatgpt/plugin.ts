import { html } from "@qino/qino";
import { connections, models } from "@qino/qino/ai1.chatgpt";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { render } };

export async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  ctx.res.headers.set("Cache-Control", "private, no-store");

  const root = ctx.req.appUrl + "ai1-chatgpt";
  const back = ctx.req.url.pathname + ctx.req.url.search;
  const local = ctx.req.url.protocol === "http:" && ctx.req.url.hostname === "127.0.0.1";
  const localUrl = new URL(ctx.req.url.href);
  localUrl.hostname = "127.0.0.1";
  const list = await connections(node.app, ctx.userId);
  const start = `${root}/start?return_to=${encodeURIComponent(back)}`;
  const csrf = ctx.csrfToken;
  const rows = await Promise.all(list.map(async (account) => html`<li>
    <strong>${account.label}</strong> ${account.active ? await t`(active)` : ""}
    ${local ? html`<a href="${start}&client_id=${encodeURIComponent(account.clientId)}">${await t`Reconnect`}</a>` : ""}
    ${account.active ? "" : html`<form method=post action="${root}/select">
      <input type=hidden name=csrf value="${csrf}"><input type=hidden name=client_id value="${account.clientId}">
      <input type=hidden name=return_to value="${back}"><button>${await t`Select`}</button>
    </form>`}
    <form method=post action="${root}/disconnect">
      <input type=hidden name=csrf value="${csrf}"><input type=hidden name=client_id value="${account.clientId}">
      <input type=hidden name=return_to value="${back}"><button>${await t`Disconnect`}</button>
    </form>
  </li>`));
  let catalog: HtmlString | string = "";
  if (list.some((account) => account.active)) {
    try {
      const names = await models(node.app, ctx.userId);
      catalog = await html.async`<p>${t`Available model IDs`}: ${html.join(names.map((name) => html`<code>${name}</code>`), ", ")}</p>`;
    } catch { catalog = await t`Model catalog is temporarily unavailable.`; }
  }
  return html.async`<div>
    ${local ? html.async`<a href="${start}">${t`Continue with ChatGPT`}</a>`
      : ctx.req.url.protocol === "http:" && ctx.req.url.hostname === "localhost"
      ? html.async`<a href="${localUrl.href}">${t`Open this page on 127.0.0.1 to connect ChatGPT`}</a>`
      : html.async`<p>${t`Open Qino on http://127.0.0.1 to connect a ChatGPT plan.`}</p>`}
    ${rows.length ? html`<ul>${html.join(rows)}</ul>` : html.async`<p>${t`No ChatGPT account connected.`}</p>`}
    ${catalog}
  </div>`;
}
