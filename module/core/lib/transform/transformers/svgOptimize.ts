import * as nodePath from 'node:path';

import * as svgo from '../svgo.ts';
import * as scour from '../scour.ts';

import type { TransformerDef } from '../types.ts';

const fileSize = async (path: string): Promise<number> => (await Deno.stat(path).catch(() => null))?.size ?? Infinity;

/**
 * Encode phase: minifies an SVG. Runs only when `q` is set – without it the stored bytes are served.
 * For a vector, quality is coordinate precision: q=100 keeps 7 digits, low q rounds paths hard.
 */
export const svgOptimize: TransformerDef = {
  name: 'svg-optimize',
  phase: 'encode',
  props: ['q'],
  handles: async (ctx) =>
    ctx.mime === 'image/svg+xml' &&
    ctx.options.q !== undefined &&
    (await svgo.available() || await scour.available()),
  transform: async (ctx) => {
    const q = Math.min(Math.max(ctx.options.q ?? 77, 1), 100);
    const precision = Math.min(Math.max(1 + Math.round(q / 100 * 6), 1), 7);
    const out = nodePath.join(ctx.tmpDir, 'out.svg');
    const minify = await svgo.available() ? svgo.run : scour.run;
    if (!await minify(ctx.currentPath, out, precision, ctx.signal)) return; // declined – keep what we have
    if (await fileSize(out) < await fileSize(ctx.currentPath)) ctx.currentPath = out;
  },
};
