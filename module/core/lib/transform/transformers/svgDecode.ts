import * as nodePath from 'node:path';

import * as rsvg from '../rsvg.ts';
import * as inkscape from '../inkscape.ts';

import type { TransformContext, TransformerDef } from '../types.ts';

const RASTER = ['png', 'jpg', 'avif'];
/** Rendered edge when the source states no intrinsic size and none is requested */
const FALLBACK = 512;
const MAX = 9000;

/** Intrinsic aspect ratio from viewBox, else width/height; 1 when unknown. */
async function ratio(path: string): Promise<number> {
  const head = (await Deno.readTextFile(path)).slice(0, 4000);
  const box = head.match(/viewBox\s*=\s*["']\s*[-\d.eE]+[,\s]+[-\d.eE]+[,\s]+([\d.eE]+)[,\s]+([\d.eE]+)/);
  const size = !box && head.match(/width\s*=\s*["']([\d.]+)[a-z%]*["'][^>]*?height\s*=\s*["']([\d.]+)/);
  const [w, h] = box ? [+box[1], +box[2]] : size ? [+size[1], +size[2]] : [0, 0];
  return w > 0 && h > 0 ? w / h : 1;
}

/** Render size: covers the requested box (`max` fits inside it), so the geometry phase only crops. */
function renderSize({ options: o }: TransformContext, ratio: number): [number, number] {
  const w = Math.min(o.w ?? 0, MAX), h = Math.min(o.h ?? 0, MAX);
  if (!w && !h) return ratio >= 1 ? [Math.round(FALLBACK * ratio), FALLBACK] : [FALLBACK, Math.round(FALLBACK / ratio)];
  if (!w) return [Math.round(h * ratio), h];
  if (!h) return [w, Math.round(w / ratio)];
  const fill = o.max ? Math.min(w / ratio, h) : Math.max(w / ratio, h);
  return [Math.round(fill * ratio), Math.round(fill)];
}

/**
 * Decode phase: rasterizes an SVG when a raster format is asked for explicitly.
 * Plain `w`/`h` requests keep the SVG – it scales by itself.
 * ImageMagick's own SVG renderer is not used: without a librsvg delegate it silently
 * drops gradients and colour.
 */
export const svgDecode: TransformerDef = {
  name: 'svg-decode',
  phase: 'decode',
  props: ['w', 'h', 'max', 'fmt'],
  handles: async (ctx) =>
    ctx.mime === 'image/svg+xml' &&
    RASTER.includes(String(ctx.options.fmt)) &&
    (await rsvg.available() || await inkscape.available()),
  transform: async (ctx) => {
    const [w, h] = renderSize(ctx, await ratio(ctx.currentPath).catch(() => 1));
    const out = nodePath.join(ctx.tmpDir, 'svg.png');
    const render = await rsvg.available() ? rsvg.run : inkscape.run;
    await render(ctx.currentPath, out, Math.max(w, 1), Math.max(h, 1), ctx.signal);
    ctx.currentPath = out;
    ctx.mime = 'image/png';
    ctx.meta.width = w;
    ctx.meta.height = h;
  },
};
