import { getCtx, html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

function vsTable(vs: Record<string, unknown>, exclude: string[] = []): HtmlString {
  const rows = Object.entries(vs)
    .filter(([k]) => !exclude.includes(k))
    .map(([k, v]) => html`<tr><td>${k}<td>${v}`);
  return html`<table>${html.join(rows, "\n")}</table>`;
}

const inspect = (value: unknown): HtmlString => html`<pre>${Deno.inspect(value, { depth: 6 })}</pre>`;

async function render(_node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const usr = ctx.user;
  const client = ctx.client;

  const clientVs = client ? client.$values() : {};
  const sessionData = await ctx.sess.data();
  const settingsData = await ctx.settings();

  let usrHtml = html`<em>not logged in</em>\n`;
  if (usr) {
    const vs = usr.$values();
    const grps = (await usr.grps()).join(", ") || "–";
    usrHtml = html`<h3>User #${usr}</h3>${vsTable(vs, ["pw"])}<h3>Groups: ${grps}</h3>\n`;
  }

  return html`<div style="font-size:11px;font-family:monospace;background:#f5f5f5;color:black; padding:.5rem;display:inline-block">
  <h3>session</h3>
  ${inspect(sessionData)}
  <h3>settings</h3>
  ${inspect(settingsData)}
  <h3>client</h3>
  ${vsTable(clientVs)}
  ${usrHtml}
  </div>`;
}

export const cms = {
  node: { render },
};
