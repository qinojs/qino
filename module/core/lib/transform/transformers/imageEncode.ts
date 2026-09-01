import * as nodePath from 'node:path';

import * as magick from '../magick.ts';
import { typeByExtension } from '../../../deps.ts';

import type { TransformContext, TransformerDef } from '../types.ts';

/** True unless the client listed its accepted types and this one is not among them. */
const canSend = (ctx: TransformContext, type: string) => !ctx.accept || ctx.accept.includes(type);

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

    // AVIF carries alpha and beats JPEG on size at comparable quality, so it needs no contender.
    // Comparing their file sizes would compare two different quality scales anyway: `-quality 77`
    // means something else in each codec, so the smaller file is not the better one.
    if (canSend(ctx, 'image/avif') && await magick.avifSupported()) {
      const out = nodePath.join(ctx.tmpDir, 'out.avif');
      await magick.run(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = 'image/avif';
      return;
    }

    // Only the fallback formats care about transparency: PNG carries it, JPEG does not.
    ctx.meta.hasAlpha = await magick.identify(ctx.currentPath, '%A', ctx.signal) === 'True';

    if (ctx.meta.hasAlpha) {
      const out = nodePath.join(ctx.tmpDir, 'out.png');
      await magick.run(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = 'image/png';
    } else {
      // Photo or flat graphic is not cheaply knowable, and here the sizes are comparable: PNG is
      // lossless, so whichever is smaller is genuinely the better pick.
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
