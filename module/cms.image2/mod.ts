// Port of cms.image2/qg.php
// deno-lint-ignore-file no-explicit-any

import * as nodeFs from "node:fs/promises";
import { Buffer } from "node:buffer";
import { hee, HtmlString } from "../core/lib/util.ts";
import { magickIdentify, magick, isMagickAvailable } from "../core/lib/transform/imagemagick.ts";
import type { DbFile } from "../core/lib/DbFileManager.ts";
import { getCtx } from "../core/lib/RequestContext.ts";

export const name = "cms.image2";

export async function cms_image2(dbFile: DbFile, options: Record<string, any>): Promise<HtmlString> {
  const ctx = getCtx();
  ctx.html.addJSFile(ctx.sysURL + "cms.image2/pub/cms-image2.js");
  ctx.html.addCSSFile(ctx.sysURL + "cms.image2/pub/cms-image2.css");
  if ((options["if"] ?? 0) && !await dbFile.exists() && !options["editable"]) return new HtmlString("");
  if (!options["quality"]) options["quality"] = "85";
  delete options["if"];
  return new HtmlString(await dbImage_html2(dbFile, options));
}

export async function dbImage_html2(dbFile: DbFile, options: Record<string, any>): Promise<string> {
  const data = await dbImage_html_2_getData(dbFile, options);
  const w = data.w || 1;
  const h = data.h || 1;
  const { vpos, hpos } = data;

  const src = await dbImage_fileUrl(dbFile, data, options);
  const alt = String(options.alt ?? "").trim() || dbImage_name2alt(String(await dbFile.get("name") ?? ""));

  const styles: Record<string, string> = { ...(options.css ?? {}) };
  if (!styles["max-width"]) styles["max-width"] = w + "px";
  styles["background-image"] = `url(${data.preview})`;
  styles["background-position"] = `${hpos}% ${vpos}%`;
  styles["--aspect-ratio"] = String(h / w);

  let styleStr = ";";
  for (const [k, v] of Object.entries(styles)) styleStr += `${k}:${v}; `;
  styleStr += options.style ?? "";

  const skip = new Set(["quality", "alt", "width", "height", "css", "style", "if", "editable"]);
  let attrStr = ` style="${hee(styleStr)}"`;
  if (options.editable) attrStr += ` dbfile-editable="${hee(options.editable)}"`;
  for (const [k, v] of Object.entries(options)) {
    if (skip.has(k)) continue;
    attrStr += v === true ? ` ${k}` : v === false ? "" : ` ${k}="${hee(String(v))}"`;
  }

  return (
    `<cms-image2${attrStr}>` +
    `<noscript><img loading=lazy style="object-position:${hpos}% ${vpos}%" src="${hee(src)}" alt="${hee(alt)}"></noscript>` +
    `</cms-image2>\n`
  );
}

async function dbImage_fileUrl(dbFile: DbFile, data: any, options: Record<string, any>): Promise<string> {
  const params: Record<string, any> = { w: data.w, h: data.h, vpos: data.vpos, hpos: data.hpos, q: options.quality ?? "85" };
  if (options.fit === "contain") params.max = true;
  return await dbFile.url(params);
}

async function dbImage_html_2_getData(dbFile: DbFile, options: Record<string, any>): Promise<any> {
  const ctx = getCtx();
  let w = Number(options.width ?? 0) || 0;
  let h = Number(options.height ?? 0) || 0;
  const hpos = options.hpos ?? await dbFile.get("hpos") ?? 50;
  const vpos = options.vpos ?? await dbFile.get("vpos") ?? 50;
  const faktor = 50;
  const maxHW = 22;

  const md5 = await dbFile.get("md5");
  const cacheFile = ctx.app.appPATH + `cache/cms-image2-data-${md5}.${vpos}.${hpos}.${w}.${h}.${faktor}.${maxHW}.${options.fit ?? ""}.json`;

  if (md5) {
    try { return JSON.parse(await nodeFs.readFile(cacheFile, "utf-8")); } catch { /* no cache */ }
  }

  const filePath = dbFile.path;
  let ow = 0, oh = 0;
  if (await isMagickAvailable() && filePath) {
    try {
      const dim = await magickIdentify(filePath, "%wx%h");
      [ow, oh] = dim.split("x").map(Number);
    } catch { /* svg or unknown */ }
  }

  if (ow) {
    const oRatio = ow / oh;
    if (!w && !h) { w = ow; h = oh; }
    if (!w) w = Math.round(h * oRatio);
    if (!h) h = Math.round(w / oRatio);
    if (options.fit === "contain") {
      if (w / h > oRatio) w = Math.round(h * oRatio);
      else h = Math.round(w / oRatio);
    }
  } else {
    if (!w) w = 800;
    if (!h) h = 600;
  }

  const preview = "";
  if (md5) {
    setTimeout(async () => {
      try {
        if (!await isMagickAvailable() || !filePath || !ow) return;
        const smallW = Math.max(Math.min(Math.round(w / faktor), maxHW), 1);
        const smallH = Math.max(Math.min(Math.round(h / faktor), maxHW), 1);
        const tmpPath = ctx.app.appPATH + `cache/cms-image2-prev-${md5}.png`;
        await nodeFs.mkdir(ctx.app.appPATH + "cache/", { recursive: true }).catch(() => {});
        await magick(filePath, [`-resize`, `${smallW}x${smallH}`, `-quality`, `9`], tmpPath);
        const buf = await nodeFs.readFile(tmpPath);
        const prev = "data:image/png;base64," + Buffer.from(buf).toString("base64");
        await nodeFs.unlink(tmpPath).catch(() => {});
        const d = { w, h, vpos, hpos, preview: prev };
        await nodeFs.writeFile(cacheFile, JSON.stringify(d));
      } catch { /* skip */ }
    }, 0);
  }

  return { w, h, vpos, hpos, preview };
}

function dbImage_name2alt(name: string): string {
  return name.replace(/_/g, " ").replace(/\.[^.]+$/, "").trim();
}
