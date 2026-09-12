// deno-lint-ignore-file no-explicit-any
import { magick } from "@qino/qino";
import { Parser } from "htmlparser2";

import type { DbFile } from "@qino/qino";

export async function imageData(file: DbFile, options: Record<string, any>, cacheDir: string) {
  const hpos = options.hpos ?? await file.get("hpos") ?? 50;
  const vpos = options.vpos ?? await file.get("vpos") ?? 50;
  const data = await file.get("mime") === "image/svg+xml"
    ? await vectorData(file, options)
    : await rasterData(file, { ...options, hpos, vpos }, cacheDir);
  return { ...data, hpos, vpos };
}

async function rasterData(file: DbFile, options: Record<string, any>, cacheDir: string) {
  const w = Number(options.width) || 0;
  const h = Number(options.height) || 0;
  const { hpos, vpos } = options;
  const FACTOR = 42;
  const MAX_HW = 30;
  const QUALITY = 60;
  const md5 = await file.get("md5");
  const cacheFile = cacheDir + `data-v2-${md5}.${vpos}.${hpos}.${w}.${h}.${FACTOR}.${QUALITY}.${MAX_HW}.${options.fit ?? ""}.json`;
  let data;
  if (md5) {
    try { data = JSON.parse(await Deno.readTextFile(cacheFile)); } catch { /* no cache */ }
  }

  if (!data) {
    let ow = 0, oh = 0;
    if (await magick.available() && file.path) {
      try {
        const dim = await magick.identify(file.path, "%wx%h");
        [ow, oh] = dim.split("x").map(Number);
      } catch { /* svg or unknown */ }
    }
    const { w, h } = imageSize(ow, oh, options);
    data = { w, h, vpos, hpos, preview: "" };
    if (md5) {
      setTimeout(async () => {
        try {
          if (!ow) return;

          // const smallW = Math.max(Math.min(Math.round(w / FACTOR), MAX_HW), 1);
          // const smallH = Math.max(Math.min(Math.round(h / FACTOR), MAX_HW), 1);

          const scale = Math.min(1 / FACTOR, MAX_HW / Math.max(w, h));
          const smallW = Math.max(1, Math.round(w * scale));
          const smallH = Math.max(1, Math.round(h * scale));

          const { path: tmpPath, mime } = await file.transform({ w: smallW, h: smallH, q: QUALITY, fmt: "png", hpos, vpos });
          const buf = await Deno.readFile(tmpPath);
          const preview = "data:" + mime + ";base64," + btoa(String.fromCharCode(...buf));
          await Deno.mkdir(cacheDir, { recursive: true });
          await Deno.writeTextFile(cacheFile, JSON.stringify({ w, h, vpos, hpos, preview }));
        } catch { /* skip */ }
      }, 0);
    }
  }
  const params: Record<string, any> = { w: data.w, h: data.h, vpos: data.vpos, hpos: data.hpos, q: options.quality ?? "85" };
  if (options.fit === "contain") params.max = true;
  return { ...data, src: await file.url(params) };
}

function imageSize(ow: number, oh: number, options: Record<string, any>) {
  let w = Number(options.width) || 0;
  let h = Number(options.height) || 0;
  if (ow && oh) {
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

  return { w, h };
}

const INLINE_LIMIT = 350;

function length(value = ""): number {
  const match = value.trim().match(/^(\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i);
  const size = match ? Number(match[1]) : 0;
  return Number.isFinite(size) ? size : 0;
}

/** SVG sources stay independent of display size; small sources need no separate request. */
async function vectorData(file: DbFile, options: Record<string, any>) {
  const params = { q: options.quality ?? "85" };
  const { path } = await file.transform(params);
  const source = path ? await Deno.readTextFile(path).catch(() => "") : "";
  let attrs: Record<string, string> = {};
  const parser = new Parser({ onopentag(name, attributes) {
    if (name === "svg") attrs = attributes;
    parser.pause();
  } }, { xmlMode: true });
  parser.end(source);

  const box = (attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const ratio = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box[2] / box[3] : 0;
  let ow = length(attrs.width), oh = length(attrs.height);
  if (ratio) {
    ow ||= oh ? oh * ratio : box[2];
    oh ||= ow / ratio;
  }
  const inline = source && source.length <= INLINE_LIMIT ? "data:image/svg+xml," + encodeURIComponent(source) : "";
  const src = inline && inline.length <= INLINE_LIMIT ? inline : await file.url(params);
  return { ...imageSize(ow, oh, options), src, preview: "" };
}
