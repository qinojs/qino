import { FileTransformer } from '../FileTransformer.ts';
import { magick } from '../imagemagick.ts';
import * as nodePath from 'node:path';

/**
 * Decode-Phase: Konvertiert eine PDF-Seite zu PNG.
 * Danach kann die normale Bild-Pipeline (resize, encode) greifen.
 */
FileTransformer.register({
  name: 'pdf-decode',
  phase: 'decode',
  props: ['page'],
  handles: (ctx) => ctx.mime === 'application/pdf' && (ctx.options.w !== undefined || ctx.options.h !== undefined || ctx.options.page !== undefined || ctx.options.fmt !== undefined || ctx.options.q !== undefined),
  transform: async (ctx) => {
    const page = (ctx.options.page ?? 1) - 1; // ImageMagick ist 0-basiert
    const out = nodePath.join(ctx.tmpDir, 'pdf-page.png');
    await magick(
      `${ctx.currentPath}[${page}]`,
      ['-density', '150', '-background', 'white', '-flatten'],
      out,
    );
    ctx.currentPath = out;
    ctx.mime = 'image/png';
  },
});
