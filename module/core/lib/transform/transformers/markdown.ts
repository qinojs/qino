import { FileTransformer } from '../FileTransformer.ts';
import { pandoc, isPandocAvailable } from '../pandoc.ts';
import { pdftotext, isPdftotextAvailable } from '../poppler.ts';
import { ocrPdf, pickOcrEngine } from '../ocr.ts';
import { isMagickAvailable } from '../imagemagick.ts';
import * as nodePath from 'node:path';
import type { TransformContext } from '../types.ts';

/** Pandoc input format per source MIME type */
const PANDOC_FORMATS: Record<string, string> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/epub+zip': 'epub',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/x-ipynb+json': 'ipynb',
  'text/x-rst': 'rst',
  'text/org': 'org',
};

/**
 * Decode phase: converts documents to Markdown (fmt=md).
 * HTML/Office/eBook via Pandoc, PDF as plain-text extraction via pdftotext.
 */
FileTransformer.register({
  name: 'markdown',
  phase: 'decode',
  props: ['fmt'],
  handles: async (ctx) => ctx.options.fmt === 'md' && (
    ctx.mime === 'application/pdf'
      ? await isPdftotextAvailable() || (!!await pickOcrEngine(ctx) && await isMagickAvailable())
      : ctx.mime in PANDOC_FORMATS && await isPandocAvailable()
  ),
  transform: async (ctx) => {
    const out = nodePath.join(ctx.tmpDir, 'out.md');
    if (ctx.mime === 'application/pdf') await pdfToMarkdown(ctx, out);
    else await pandoc(ctx.currentPath, PANDOC_FORMATS[ctx.mime], out, ctx.signal);
    ctx.currentPath = out;
    ctx.mime = 'text/markdown';
  },
});

/** Text layer via pdftotext; OCR when the engine beats it (AI) or there is no text layer (scan) */
async function pdfToMarkdown(ctx: TransformContext, out: string): Promise<void> {
  let text: string | undefined;
  if (await isPdftotextAvailable()) {
    await pdftotext(ctx.currentPath, out, ctx.signal);
    text = (await Deno.readTextFile(out)).trim();
  }
  const engine = await pickOcrEngine(ctx);
  if (engine && (engine.beatsTextLayer || !text || text.length < 20)) {
    const ocred = await ocrPdf(ctx, engine);
    if (ocred !== undefined) return Deno.writeTextFile(out, ocred);
  }
  if (text === undefined) throw new Error('markdown: pdftotext missing and OCR failed');
}
