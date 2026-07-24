import * as nodePath from 'node:path';
import type { OcrEngine, TransformContext } from './types.ts';
import * as magick from './magick.ts';
import * as tesseract from './tesseract.ts';

/** Rasterizes all PDF pages and OCRs them. Returns undefined if no engine or no ImageMagick. */
export async function ocrPdf(ctx: TransformContext, engine?: OcrEngine): Promise<string | undefined> {
  engine ??= await ctx.transformer.ocrEngine(ctx);
  if (!engine || !await magick.available()) return;
  const pattern = nodePath.join(ctx.tmpDir, 'ocr-page-%04d.png');
  await magick.run(ctx.currentPath, ['-background', 'white', '-alpha', 'remove'], pattern, { preArgs: ['-density', '300'], signal: ctx.signal });
  const pages = (await Array.fromAsync(Deno.readDir(ctx.tmpDir)))
    .map((e) => e.name).filter((n) => n.startsWith('ocr-page-')).sort();
  const texts: string[] = [];
  for (const page of pages) texts.push(await engine.ocr(nodePath.join(ctx.tmpDir, page), 'image/png', ctx));
  return texts.join('\n\n');
}

/** Default OCR engine */
export const tesseractEngine: OcrEngine = {
  name: 'tesseract',
  priority: 0,
  available: () => tesseract.available(),
  ocr: (imagePath, _mime, ctx) => tesseract.run(imagePath, ctx.signal),
};
