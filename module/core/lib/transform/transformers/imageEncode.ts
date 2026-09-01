import * as nodePath from 'node:path';

import * as magick from '../magick.ts';
import { typeByExtension } from '../../../deps.ts';

import type { TransformerDef } from '../types.ts';

/** File size in bytes; a missing file is `Infinity` so it loses the smaller-output comparison. */
const fileSize = async (path: string): Promise<number> => (await Deno.stat(path).catch(() => null))?.size ?? Infinity;

/**
 * Encode phase: selects optimal output format (AVIF > JPEG > PNG) and sets quality.
 * Runs only when geometry has been applied or q/fmt is set explicitly.
 */
export const imageEncode: TransformerDef = {
  name: 'image-encode',
  phase: 'encode',
  props: ['q', 'fmt'],
  handles: async (ctx) =>
    await magick.available() &&
    ctx.mime.startsWith('image/') &&
    ctx.mime !== 'image/svg+xml' &&
    (ctx.meta.geometryApplied || ctx.options.q !== undefined || (ctx.options.fmt !== undefined && ctx.options.fmt !== 'md')),
  transform: async (ctx) => {
    const q = Math.min(Math.max(ctx.options.q ?? 77, 1), 100);
    const fmt = ctx.options.fmt === 'md' ? 'auto' : ctx.options.fmt ?? 'auto';

    // Explicit format requested
    if (fmt !== 'auto') {
      const out = nodePath.join(ctx.tmpDir, `out.${fmt}`);
      await magick.run(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = typeByExtension(fmt) ?? 'application/octet-stream';
      return;
    }

    // Check alpha channel
    ctx.meta.hasAlpha = await magick.identify(ctx.currentPath, '%A', ctx.signal) === 'True';

    const avifSupported = await magick.avifSupported();

    if (avifSupported) {
      // AVIF carries alpha, JPEG does not — so JPEG only competes for opaque images.
      // Otherwise a mostly transparent image (a logo) picks the smaller JPEG and
      // silently loses its alpha. Both are encoded from the source, never from each other.
      const src = ctx.currentPath;
      const avif = nodePath.join(ctx.tmpDir, 'out.avif');
      const jpg = ctx.meta.hasAlpha ? '' : nodePath.join(ctx.tmpDir, 'out.jpg');
      await Promise.all([
        magick.run(src, ['-quality', String(q)], avif, { signal: ctx.signal }),
        jpg && magick.run(src, ['-quality', String(q)], jpg, { signal: ctx.signal }),
      ]);
      const [sizeAvif, sizeJpg] = await Promise.all([fileSize(avif), jpg ? fileSize(jpg) : Infinity]);
      if (jpg && sizeJpg < sizeAvif) {
        ctx.currentPath = jpg;
        ctx.mime = 'image/jpeg';
      } else {
        ctx.currentPath = avif;
        ctx.mime = 'image/avif';
      }
    } else if (ctx.meta.hasAlpha) {
      // No AVIF, alpha present → PNG
      const out = nodePath.join(ctx.tmpDir, 'out.png');
      await magick.run(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = 'image/png';
    } else {
      // No AVIF, no alpha → JPEG vs PNG, the smaller one wins
      const jpg = nodePath.join(ctx.tmpDir, 'out.jpg');
      const png = nodePath.join(ctx.tmpDir, 'out.png');
      await Promise.all([
        magick.run(ctx.currentPath, ['-quality', String(q)], jpg, { signal: ctx.signal }),
        magick.run(ctx.currentPath, [], png, { signal: ctx.signal }),
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
