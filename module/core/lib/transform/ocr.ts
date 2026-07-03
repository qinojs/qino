import * as nodePath from 'node:path';
import type { TransformContext } from './types.ts';
import { isMagickAvailable, magick } from './imagemagick.ts';
import { isTesseractAvailable, tesseract } from './tesseract.ts';

/** OCR engine registry. Core ships Tesseract; modules may register better engines (e.g. AI vision). */
export interface OcrEngine {
  name: string;
  /** Higher priority wins among available engines */
  priority: number;
  /** Produces better output than a PDF's embedded text layer (e.g. layout-aware AI) — PDFs are then always OCRed, not only scans */
  beatsTextLayer?: boolean;
  available: (ctx: TransformContext) => boolean | Promise<boolean>;
  /** Extracts text/Markdown from an image file */
  ocr: (imagePath: string, mime: string, ctx: TransformContext) => Promise<string>;
}

const engines: OcrEngine[] = [];

export function registerOcrEngine(engine: OcrEngine): void {
  engines.push(engine);
  engines.sort((a, b) => b.priority - a.priority);
}

export async function pickOcrEngine(ctx: TransformContext): Promise<OcrEngine | undefined> {
  for (const engine of engines) if (await engine.available(ctx)) return engine;
}

/** Rasterizes all PDF pages and OCRs them. Returns undefined if no engine or no ImageMagick. */
export async function ocrPdf(ctx: TransformContext, engine?: OcrEngine): Promise<string | undefined> {
  engine ??= await pickOcrEngine(ctx);
  if (!engine || !await isMagickAvailable()) return;
  const pattern = nodePath.join(ctx.tmpDir, 'ocr-page-%04d.png');
  await magick(ctx.currentPath, ['-background', 'white', '-alpha', 'remove'], pattern, ['-density', '300']);
  const pages = (await Array.fromAsync(Deno.readDir(ctx.tmpDir)))
    .map((e) => e.name).filter((n) => n.startsWith('ocr-page-')).sort();
  const texts: string[] = [];
  for (const page of pages) texts.push(await engine.ocr(nodePath.join(ctx.tmpDir, page), 'image/png', ctx));
  return texts.join('\n\n');
}

registerOcrEngine({
  name: 'tesseract',
  priority: 0,
  available: () => isTesseractAvailable(),
  ocr: (imagePath) => tesseract(imagePath),
});
