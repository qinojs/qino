// deno-lint-ignore-file no-explicit-any

import { hee, html, magickIdentify, type HtmlString, isMagickAvailable, getCtx, type DbFile } from "../core/mod.ts";

export async function cms_image2(dbFile: DbFile, options: Record<string, any>): Promise<HtmlString> {
  const ctx = getCtx();
  ctx.res.html.legacyScripts.add(ctx.req.modulePath + "cms.image2/pub/cms-image2.js");
  ctx.res.html.styles.add(ctx.req.modulePath + "cms.image2/pub/cms-image2.css");
  if (options["if"] && !await dbFile.exists() && !options["editable"]) return html.raw("");
  options["quality"] ||= "85";
  delete options["if"];
  return html.raw(await imageHtml(dbFile, options, ctx.app.appPATH));
}

async function imageHtml(dbFile: DbFile, options: Record<string, any>, appPATH: string): Promise<string> {
  const data = await getData(dbFile, options, appPATH);
  const w = data.w || 1;
  const h = data.h || 1;
  const { vpos, hpos } = data;

  const src = await fileUrl(dbFile, data, options);
  const alt = String(options.alt ?? "").trim() || name2alt(String(await dbFile.get("name") ?? ""));

  const styles: Record<string, string> = { ...(options.css ?? {}) };
  styles["max-width"] ||= w + "px";
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
    attrStr += v === true ? ` ${k}` : v === false ? "" : ` ${k}="${hee(v)}"`;
  }

  return (
    `<cms-image2${attrStr}>` +
    `<noscript><img loading=lazy style="object-position:${hpos}% ${vpos}%" src="${hee(src)}" alt="${hee(alt)}"></noscript>` +
    `</cms-image2>\n`
  );
}

function fileUrl(dbFile: DbFile, data: any, options: Record<string, any>): Promise<string> {
  const params: Record<string, any> = { w: data.w, h: data.h, vpos: data.vpos, hpos: data.hpos, q: options.quality ?? "85" };
  if (options.fit === "contain") params.max = true;
  return dbFile.url(params);
}

async function getData(dbFile: DbFile, options: Record<string, any>, appPATH = getCtx().app.appPATH): Promise<any> {
  let w = Number(options.width) || 0;
  let h = Number(options.height) || 0;
  const hpos = options.hpos ?? await dbFile.get("hpos") ?? 50;
  const vpos = options.vpos ?? await dbFile.get("vpos") ?? 50;
  const faktor = 42;
  const maxHW = 30;

  const md5 = await dbFile.get("md5");
  const cacheFile = appPATH + `cache/cms-image2-data-${md5}.${vpos}.${hpos}.${w}.${h}.${faktor}.${maxHW}.${options.fit ?? ""}.json`;

  if (md5) {
    try { return JSON.parse(await Deno.readTextFile(cacheFile)); } catch { /* no cache */ }
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
    w ||= Math.round(h * oRatio);
    h ||= Math.round(w / oRatio);
    if (options.fit === "contain") {
      if (w / h > oRatio) w = Math.round(h * oRatio);
      else h = Math.round(w / oRatio);
    }
  } else {
    w ||= 800;
    h ||= 600;
  }

  if (md5) {
    setTimeout(async () => {
      try {
        if (!ow) return;
        const smallW = Math.max(Math.min(Math.round(w / faktor), maxHW), 1);
        const smallH = Math.max(Math.min(Math.round(h / faktor), maxHW), 1);
        const { path: tmpPath, mime } = await dbFile.transform({ w: smallW, h: smallH, q: 5, fmt: "png", hpos, vpos });
        const buf = await Deno.readFile(tmpPath);
        const prev = "data:" + mime + ";base64," + btoa(String.fromCharCode(...buf));
        await Deno.writeTextFile(cacheFile, JSON.stringify({ w, h, vpos, hpos, preview: prev }));
      } catch { /* skip */ }
    }, 0);
  }

  return { w, h, vpos, hpos, preview: "" };
}

function name2alt(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}