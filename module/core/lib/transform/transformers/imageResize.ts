import { FileTransformer } from '../FileTransformer.ts';
import { magick, magickIdentify, isMagickAvailable } from '../imagemagick.ts';
import * as nodePath from 'node:path';

/**
 * Geometry phase: resize + crop with focus point (hpos/vpos).
 * Does not run for animated GIFs.
 */
FileTransformer.register({
  name: 'image-resize',
  phase: 'geometry',
  props: ['w', 'h', 'vpos', 'hpos', 'zoom', 'max'],
  handles: async (ctx) =>
    await isMagickAvailable() &&
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
    const max = ctx.options.max ?? false;

    const dims = await magickIdentify(ctx.currentPath, '%wx%h');
    const [origW, origH] = dims.split('x').map(Number);

    // Prevent upscaling
    let w = targetW ? Math.min(origW, targetW) : 0;
    let h = targetH ? Math.min(origH, targetH) : 0;

    const out = nodePath.join(ctx.tmpDir, 'resized');

    if (max || h === 0 || w === 0) {
      // Scale only, no crop – '>' prevents upscaling
      const size = w && h ? `${w}x${h}>` : w ? `${w}>` : `x${h}>`;
      await magick(ctx.currentPath, ['-resize', size], out);
    } else {
      // After upscale lock, restore target aspect ratio (PHP: makeProportional before getAutoCroped)
      if (targetW / targetH > w / h) {
        h = Math.round((targetH / targetW) * w);
      } else {
        w = Math.round((targetW / targetH) * h);
      }

      // Scale-to-fill + Crop um Fokuspunkt
      const scaleDefault = Math.max(w / origW, h / origH);
      const scale = zoom ? Math.max(1 / zoom, scaleDefault) : scaleDefault;
      const rW = Math.round(origW * scale);
      const rH = Math.round(origH * scale);

      // Crop-Offset: PHP-kompatibel = (Restplatz) * Position%
      const cropX = Math.round((rW - w) * hpos / 100);
      const cropY = Math.round((rH - h) * vpos / 100);

      await magick(
        ctx.currentPath,
        [
          '-resize', `${rW}x${rH}`,
          '-crop', `${w}x${h}+${cropX}+${cropY}`,
          '+repage',
        ],
        out,
      );
    }

    ctx.currentPath = out;
    ctx.meta.width = w || origW;
    ctx.meta.height = h || origH;
    ctx.meta.geometryApplied = true;
  },
});
