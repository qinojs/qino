import * as nodePath from 'node:path';

import * as magick from '../magick.ts';
import { typeByExtension } from '../../../deps.ts';
import { fs } from '../../fs.ts';

import type { TransformContext, TransformerDef } from '../types.ts';

/** True unless the client listed its accepted types and this one is not among them. */
const canSend = (ctx: TransformContext, type: string) => !ctx.accept || ctx.accept.includes(type);

/** File size in bytes; missing = `Infinity`, so it loses the size comparison. */
// written by a subprocess, so not cached
const fileSize = async (path: string): Promise<number> => await fs.size(path, { ttl: 0 }) ?? Infinity;

/**
 * Encode phase: picks the output format (AVIF > JPEG > PNG) and quality.
 * Runs only after a resize or with explicit q/fmt.
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

    // AVIF supports alpha and is smaller than JPEG at similar quality, so no comparison. Sizes
    // wouldn't be comparable anyway: `-quality 77` means something different per codec.
    if (canSend(ctx, 'image/avif') && await magick.avifSupported()) {
      const out = nodePath.join(ctx.tmpDir, 'out.avif');
      await magick.run(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = 'image/avif';
      return;
    }

    // Transparency: PNG supports it, JPEG does not.
    ctx.meta.hasAlpha = await magick.identify(ctx.currentPath, '%A', ctx.signal) === 'True';

    if (ctx.meta.hasAlpha) {
      const out = nodePath.join(ctx.tmpDir, 'out.png');
      await magick.run(ctx.currentPath, ['-quality', String(q)], out, { signal: ctx.signal });
      ctx.currentPath = out;
      ctx.mime = 'image/png';
    } else {
      // Photo or graphic is hard to tell; PNG is lossless, so the smaller file is the better one.
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
