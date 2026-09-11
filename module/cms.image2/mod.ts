// deno-lint-ignore-file no-explicit-any
import { hee, html, getCtx } from "@qino/qino";

import manifest from "./manifest.json" with { type: "json" };
import { imageData } from "./imageData.ts";

import type { HtmlString, DbFile } from "@qino/qino";

const { name } = manifest;

export async function cms_image2(dbFile: DbFile, options: Record<string, any>): Promise<HtmlString> {
  const ctx = getCtx();
  ctx.res.html.legacyScripts.add(ctx.req.moduleUrl + "cms.image2/pub/cms-image2.js");
  ctx.res.html.styles.add(ctx.req.moduleUrl + "cms.image2/pub/cms-image2.css");
  if (options.if && !await dbFile.exists() && !options.editable) return html.raw("");
  options.quality ||= "85";
  delete options.if;
  return html.raw(await imageHtml(dbFile, options, ctx.app.modules.get(name)!.cache));
}

async function imageHtml(dbFile: DbFile, options: Record<string, any>, cacheDir: string): Promise<string> {
  const data = await imageData(dbFile, options, cacheDir);
  const w = data.w || 1;
  const h = data.h || 1;
  const { vpos, hpos } = data;
  const position = Number(hpos) === 50 && Number(vpos) === 50 ? "" : `${hpos}% ${vpos}%`;

  const alt = String(options.alt ?? "").trim() || name2alt(String(await dbFile.get("name") ?? ""));

  const styles: Record<string, string> = { ...(options.css ?? {}) };
  styles["--image-width"] ||= w + "px";
  if (data.preview) styles["background-image"] = `url(${data.preview})`;
  if (position) styles["background-position"] = position;
  styles["--aspect-ratio"] = `${w}/${h}`;

  let styleStr = Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(";");
  if (options.style) styleStr += ";" + options.style;

  const SKIP = new Set(["quality", "alt", "width", "height", "css", "style", "if", "editable"]);
  let attrStr = ` style="${hee(styleStr)}"`;
  if (options.editable) attrStr += ` dbfile-editable="${hee(options.editable)}"`;
  for (const [k, v] of Object.entries(options)) {
    if (SKIP.has(k) || k === "fit" && v === "cover") continue;
    attrStr += v === true ? ` ${k}` : v === false ? "" : ` ${k}="${hee(v)}"`;
  }

  return (
    `<cms-image2${attrStr}>` +
    `<noscript><img loading=lazy${position ? ` style="object-position:${hee(position)}"` : ""} src="${hee(data.src)}" alt="${hee(alt)}"></noscript>` +
    `</cms-image2>\n`
  );
}

function name2alt(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}
