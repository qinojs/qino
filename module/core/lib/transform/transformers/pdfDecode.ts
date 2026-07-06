import { FileTransformer } from '../FileTransformer.ts';
import { magick } from '../imagemagick.ts';
import * as nodePath from 'node:path';

/**
 * Decode phase: converts a PDF page to PNG.
 * After this the normal image pipeline (resize, encode) can take over.
 */
FileTransformer.register({
  name: 'pdf-decode',
  phase: 'decode',
  props: ['page'],
  handles: (ctx) => ctx.mime === 'application/pdf' && ctx.options.fmt !== 'md' && (ctx.options.w !== undefined || ctx.options.h !== undefined || ctx.options.page !== undefined || ctx.options.fmt !== undefined || ctx.options.q !== undefined),
  transform: async (ctx) => {
    const page = (ctx.options.page ?? 1) - 1; // ImageMagick is 0-based
    const out = nodePath.join(ctx.tmpDir, 'pdf-page.png');
    await magick(
      `${ctx.currentPath}[${page}]`,
      ['-background', 'white', '-flatten'],
      out,
      { preArgs: ['-density', '300'], signal: ctx.signal }, // preArgs: Ghostscript render DPI (default 72 = blurry)
    );
    ctx.currentPath = out;
    ctx.mime = 'image/png';
  },
});
