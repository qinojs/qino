import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cssLength } from "../lib/css.ts";

export const name = "cms.cont.video.youtube2";
export const description = "Legacy responsive YouTube embed.";
export const needs = ["cms"];

function videoId(value: string): string {
  const url = URL.parse(value);
  const id = url?.hostname === "youtu.be" ? url.pathname.slice(1) : url?.searchParams.get("v") ?? url?.pathname.match(/\/embed\/([^/]+)/)?.[1];
  return /^[\w-]{6,32}$/.test(id ?? value) ? (id ?? value) : "";
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const textUrl = String(await node.showText("__url")).replace(/<[^>]*>/g, "").trim();
  const raw = textUrl || String(await node.settings.url ?? "").trim();
  if (raw === "-") return html`<div></div>`;
  const id = videoId(raw);
  if (!id) return html`<div></div>`;
  ctx.res.csp["frame-src"]["https://www.youtube.com"] = true;
  const maxWidth = cssLength(await node.settings["max-width"], "px", "100%");
  const ratio = Math.max(0.1, Math.min(2, Number(await node.settings._h2w) || .5625));
  const params = new URLSearchParams({ version: "3", hd: "1", html5: "1", wmode: "opaque", enablejsapi: "1", hl: ctx.lang });
  for (const key of ["autoplay", "rel", "modestbranding", "controls", "loop", "start", "end", "mute", "cc_load_policy"]) {
    const value = String(await node.settings[key] ?? "");
    if (value) params.set(key, value);
  }
  const title = String(await node.showTitle()).replace(/<[^>]*>/g, "") || "Youtube video";

  return html`<div style="max-width:${maxWidth}"><div class=-wrapper style="padding-bottom:${ratio * 100}%">
  <iframe src="https://www.youtube.com/embed/${id}?${params}" frameborder=0 allowfullscreen title="${title}"></iframe>
</div></div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
