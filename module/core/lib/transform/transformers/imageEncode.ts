import { magick, magickIdentify, checkAvifSupport, fileSize, isMagickAvailable } from '../imagemagick.ts';
import type { TransformerDef } from '../types.ts';
import * as nodePath from 'node:path';

/**
 * Encode phase: selects optimal output format (AVIF > JPEG > PNG) and sets quality.
 * Runs only when geometry has been applied or q/fmt is set explicitly.
 */
export const imageEncode: TransformerDef = {
  name: 'image-encode',
  phase: 'encode',
  props: ['q', 'fmt'],
  handles: async (ctx) =>
    await isMagickAvailable() &&
    ctx.mime.startsWith('image/') &&
    ctx.mime !== 'image/svg+xml' &&
    (ctx.meta.geometryApplied || ctx.options.q !== undefined || (ctx.options.fmt !== undefined && ctx.options.fmt !== 'md')),
  transform: async (ctx) => {
    const q = Math.min(Math.max(ctx.options.q ?? 77, 1), 100);
    const fmt = ctx.options.fmt === 'jpg' ? 'jpeg' : (ctx.options.fmt === 'md' ? 'auto' : ctx.options.fmt ?? 'auto');

    // Explicit format requested
    if (fmt !== 'auto') {
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      const out = nodePath.join(ctx.tmpDir, `out.${ext}`);
      await magick(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = mimeForFmt(fmt);
      return;
    }

    // Check alpha channel
    const alphaFlag = await magickIdentify(ctx.currentPath, '%A', ctx.signal);
    ctx.meta.hasAlpha = alphaFlag === 'True';

    const avifAvailable = await checkAvifSupport();

    if (avifAvailable) {
      // AVIF supports alpha natively – AVIF vs JPEG, smaller file wins
      const avif = nodePath.join(ctx.tmpDir, 'out.avif');
      const jpg = nodePath.join(ctx.tmpDir, 'out.jpg');
      await Promise.all([
        magick(ctx.currentPath, ['-quality', String(q)], avif, { signal: ctx.signal }),
        magick(ctx.currentPath, ['-quality', String(q)], jpg, { signal: ctx.signal }),
      ]);
      const [sizeAvif, sizeJpg] = await Promise.all([fileSize(avif), fileSize(jpg)]);
      if (sizeAvif <= sizeJpg) {
        ctx.currentPath = avif;
        ctx.mime = 'image/avif';
      } else {
        ctx.currentPath = jpg;
        ctx.mime = 'image/jpeg';
      }
    } else if (ctx.meta.hasAlpha) {
      // Kein AVIF, Alpha vorhanden → PNG
      const out = nodePath.join(ctx.tmpDir, 'out.png');
      await magick(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = 'image/png';
    } else {
      // No AVIF, no alpha → JPEG vs PNG, the smaller one wins
      const jpg = nodePath.join(ctx.tmpDir, 'out.jpg');
      const png = nodePath.join(ctx.tmpDir, 'out.png');
      await Promise.all([
        magick(ctx.currentPath, ['-quality', String(q)], jpg, { signal: ctx.signal }),
        magick(ctx.currentPath, [], png, { signal: ctx.signal }),
      ]);
      const [sizeJpg, sizePng] = await Promise.all([fileSize(jpg), fileSize(png)]);
      if (sizeJpg <= sizePng) {
        ctx.currentPath = jpg;
        ctx.mime = 'image/jpeg';
      } else {
        ctx.currentPath = png;
        ctx.mime = 'image/png';
      }
    }
  },
};

function mimeForFmt(fmt: string): string {
  return { avif: 'image/avif', jpeg: 'image/jpeg', png: 'image/png' }[fmt] ?? 'application/octet-stream';
}
