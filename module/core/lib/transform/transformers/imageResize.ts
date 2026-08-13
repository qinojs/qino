import * as nodePath from 'node:path';

import * as magick from '../magick.ts';

import type { TransformerDef } from '../types.ts';

/**
 * Geometry phase: resize + crop with focus point (hpos/vpos).
 * Does not run for animated GIFs.
 */
export const imageResize: TransformerDef = {
  name: 'image-resize',
  phase: 'geometry',
  props: ['w', 'h', 'vpos', 'hpos', 'zoom', 'max'],
  handles: async (ctx) =>
    await magick.available() &&
    ctx.mime.startsWith('image/') &&
    ctx.mime !== 'image/svg+xml' &&
    !ctx.meta.animated &&
    (!!ctx.options.w || !!ctx.options.h),
  transform: async (ctx) => {
    const targetW = Math.min(ctx.options.w ?? 0, 9000);
    const targetH = Math.min(ctx.options.h ?? 0, 9000);
    const vpos = ctx.options.vpos ?? 20;
    const hpos = ctx.options.hpos ?? 50;
    const zoom = ctx.options.zoom ?? 0;
    const max = ctx.options.max;

    const dims = await magick.identify(ctx.currentPath, '%wx%h', ctx.signal);
    const [origW, origH] = dims.split('x').map(Number);

    // Prevent upscaling
    let w = targetW ? Math.min(origW, targetW) : 0;
    let h = targetH ? Math.min(origH, targetH) : 0;

    const out = nodePath.join(ctx.tmpDir, 'resized');

    if (max || h === 0 || w === 0) {
      // Scale only, no crop – '>' prevents upscaling
      const size = w && h ? `${w}x${h}>` : w ? `${w}>` : `x${h}>`;
      await magick.run(ctx.currentPath, ['-resize', size], out, { signal: ctx.signal });
    } else {
      // After upscale lock, restore target aspect ratio (PHP: makeProportional before getAutoCroped)
      if (targetW / targetH > w / h) h = Math.round((targetH / targetW) * w);
      else w = Math.round((targetW / targetH) * h);

      // Scale-to-fill + crop around the focus point
      const scaleDefault = Math.max(w / origW, h / origH);
      const scale = zoom ? Math.max(1 / zoom, scaleDefault) : scaleDefault;
      const rW = Math.round(origW * scale);
      const rH = Math.round(origH * scale);

      // Crop-Offset: PHP-kompatibel = (Restplatz) * Position%
      const cropX = Math.round((rW - w) * hpos / 100);
      const cropY = Math.round((rH - h) * vpos / 100);

      await magick.run(
        ctx.currentPath,
        [
          '-resize', `${rW}x${rH}`,
          '-crop', `${w}x${h}+${cropX}+${cropY}`,
          '+repage',
        ],
        out,
        { signal: ctx.signal },
      );
    }

    ctx.currentPath = out;
    ctx.meta.width = w || origW;
    ctx.meta.height = h || origH;
    ctx.meta.geometryApplied = true;
  },
};
