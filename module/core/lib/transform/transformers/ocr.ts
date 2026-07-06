import { FileTransformer } from '../FileTransformer.ts';
import { pickOcrEngine } from '../ocr.ts';
import { isMagickAvailable, magick } from '../imagemagick.ts';
import * as nodePath from 'node:path';

/** Formats every OCR engine (incl. AI vision providers) can read directly */
const DIRECT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Decode phase: extracts text from images via OCR (fmt=md).
 * Engine choice (AI vision before Tesseract) lives in ../ocr.ts.
 */
FileTransformer.register({
  name: 'ocr',
  phase: 'decode',
  props: ['fmt'],
  handles: async (ctx) => ctx.options.fmt === 'md' && ctx.mime.startsWith('image/') && !!await pickOcrEngine(ctx),
  transform: async (ctx) => {
    const engine = await pickOcrEngine(ctx);
    if (!engine) return;
    let path = ctx.currentPath;
    let mime = ctx.mime;
    if (!DIRECT.has(mime) && await isMagickAvailable()) { // e.g. AVIF/HEIC/TIFF
      path = nodePath.join(ctx.tmpDir, 'ocr-src.png');
      await magick(`${ctx.currentPath}[0]`, [], path, { signal: ctx.signal }); // [0]: first frame/page only
      mime = 'image/png';
    }
    const out = nodePath.join(ctx.tmpDir, 'ocr.md');
    await Deno.writeTextFile(out, await engine.ocr(path, mime, ctx));
    ctx.currentPath = out;
    ctx.mime = 'text/markdown';
  },
});
