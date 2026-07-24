import * as pandoc from '../pandoc.ts';
import * as pdftotext from '../pdftotext.ts';
import { ocrPdf } from '../ocr.ts';
import * as magick from '../magick.ts';
import * as nodePath from 'node:path';
import type { Transcript, TransformContext, TransformerDef } from '../types.ts';
import { TRANSCRIPT_MIME } from './transcript.ts';

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
export const markdown: TransformerDef = {
  name: 'markdown',
  phase: 'decode',
  props: ['fmt'],
  handles: async (ctx) => ctx.options.fmt === 'md' && (
    ctx.mime === TRANSCRIPT_MIME
      ? true
      : ctx.mime === 'application/pdf'
      ? await pdftotext.available() || (!!await ctx.transformer.ocrEngine(ctx) && await magick.available())
      : ctx.mime in PANDOC_FORMATS && await pandoc.available()
  ),
  transform: async (ctx) => {
    const out = nodePath.join(ctx.tmpDir, 'out.md');
    if (ctx.mime === TRANSCRIPT_MIME) await Deno.writeTextFile(out, transcriptToMarkdown(JSON.parse(await Deno.readTextFile(ctx.currentPath))));
    else if (ctx.mime === 'application/pdf') await pdfToMarkdown(ctx, out);
    else await pandoc.run(ctx.currentPath, PANDOC_FORMATS[ctx.mime], out, ctx.signal);
    ctx.currentPath = out;
    ctx.mime = 'text/markdown';
  },
};

/** Text layer via pdftotext; OCR when the engine beats it (AI) or there is no text layer (scan) */
async function pdfToMarkdown(ctx: TransformContext, out: string): Promise<void> {
  let text: string | undefined;
  if (await pdftotext.available()) {
    await pdftotext.run(ctx.currentPath, out, ctx.signal);
    text = (await Deno.readTextFile(out)).trim();
  }
  const engine = await ctx.transformer.ocrEngine(ctx);
  if (engine && (engine.beatsTextLayer || !text || text.length < 20)) {
    const ocred = await ocrPdf(ctx, engine);
    if (ocred !== undefined) return Deno.writeTextFile(out, ocred);
  }
  if (text === undefined) throw new Error('markdown: pdftotext missing and OCR failed');
}

function transcriptToMarkdown(t: Transcript): string {
  const parts = (t.segments?.length ? t.segments : [{ text: t.text }]).map((s) => {
    const text = String(s.text ?? '').trim();
    const notes = Array.isArray(s.notes) ? s.notes.map((n) => `(${String(n).trim().replace(/^\(|\)$/g, '')})`).join(' ') : '';
    const line = [text, notes].filter(Boolean).join('\n\n');
    return s.speaker ? `**${s.speaker}:** ${line}` : line;
  }).filter(Boolean);
  return (parts.join('\n\n') || String(t.text ?? '').trim()) + '\n';
}
