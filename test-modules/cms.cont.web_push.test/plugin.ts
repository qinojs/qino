import { html, type HtmlString } from "@qino/qino";
import { channels } from "@qino/qino/messaging.web_push";
import type { Node } from "@qino/qino/cms";

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
  const names = (await channels(node.app)).map((c) => String(c.name));
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
