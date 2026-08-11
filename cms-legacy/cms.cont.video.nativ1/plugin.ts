import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.video.nativ1";
export const description = "Legacy native MP4 video.";
export const needs = ["cms"];

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
