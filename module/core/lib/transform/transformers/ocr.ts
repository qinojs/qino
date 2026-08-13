import * as nodePath from 'node:path';

import * as magick from '../magick.ts';

import type { TransformerDef } from '../types.ts';

/** Formats every OCR engine (incl. AI vision providers) can read directly */
const DIRECT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Decode phase: extracts text from images via OCR (fmt=md).
 * Engine choice (AI vision before Tesseract) lives on the FileTransformer instance.
 */
export const ocr: TransformerDef = {
  name: 'ocr',
  phase: 'decode',
  props: ['fmt'],
  handles: async (ctx) => ctx.options.fmt === 'md' && ctx.mime.startsWith('image/') && !!await ctx.transformer.ocrEngine(ctx),
  transform: async (ctx) => {
    const engine = await ctx.transformer.ocrEngine(ctx);
    if (!engine) return;
    let path = ctx.currentPath;
    let mime = ctx.mime;
    if (!DIRECT.has(mime) && await magick.available()) { // e.g. AVIF/HEIC/TIFF
      path = nodePath.join(ctx.tmpDir, 'ocr-src.png');
      await magick.run(`${ctx.currentPath}[0]`, [], path, { signal: ctx.signal }); // [0]: first frame/page only
      mime = 'image/png';
    }
    const out = nodePath.join(ctx.tmpDir, 'ocr.md');
    await Deno.writeTextFile(out, await engine.ocr(path, mime, ctx));
    ctx.currentPath = out;
    ctx.mime = 'text/markdown';
  },
};
