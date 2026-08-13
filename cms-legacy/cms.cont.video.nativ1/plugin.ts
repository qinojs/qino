import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const flags = ["autoplay", "muted", "loop", "controls"] as const;

async function render(node: Node): Promise<HtmlString> {
  const file = await node.file("Video mp4");
  if (!await file.exists()) return html`<div></div>`;
  const active: string[] = [];
  for (const flag of flags) if (await node.settings[flag]) active.push(flag);
  return html`<div><video${html.raw(active.length ? " " + active.join(" ") : "")}>
  <source src="${await file.url()}" type="${file.mime || "video/mp4"}">
</video></div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema: { properties: Object.fromEntries(flags.map((flag) => [flag, { type: "boolean" }])) },
  },
};
