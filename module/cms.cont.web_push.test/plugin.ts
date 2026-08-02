import type { Node } from "../cms/mod.ts";
import { html, type HtmlString } from "../core/mod.ts";
import { channels } from "../messaging.web_push/mod.ts";

export const name = "cms.cont.web_push.test";
export const description = "Lets a visitor subscribe this browser to push channels.";
export const needs = ["messaging.web_push"];

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
  },
};

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const names = await channels(node.app);
  if (!names.length) return html.async`<p>${t`No push channels are defined yet.`}`;

  const boxes = html.join(names.map((c) =>
    html`<label><input type=checkbox name=channel value="${c}" disabled> ${c}</label>`
  ));

  return html.async`<form>
  <p>${t`Pick what this browser should be notified about:`}
  ${boxes}
  <output name=msg>${t`Checking…`}</output>
</form>`;
}
