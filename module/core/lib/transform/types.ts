import type { FileTransformer } from './FileTransformer.ts';

export type Phase = 'decode' | 'geometry' | 'filter' | 'encode';

export interface TransformOptions {
  w?: number;
  h?: number;
  q?: number;
  max?: boolean;
  vpos?: number;
  hpos?: number;
  zoom?: number;
  dpr?: number;
  page?: number;
  frame?: number;
  fmt?: 'avif' | 'jpeg' | 'jpg' | 'png' | 'md' | 'json' | 'auto';
  [key: string]: unknown;
}

export interface TransformMeta {
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  animated?: boolean;
  geometryApplied?: boolean;
  [key: string]: unknown;
}

export interface TransformContext {
  /** Owning instance — e.g. for OCR engine lookup */
  readonly transformer: FileTransformer;
  readonly sourcePath: string;
  currentPath: string;
  mime: string;
  options: TransformOptions;
  meta: TransformMeta;
  tmpDir: string;
  /** Kills external commands when the pipeline exceeds `transformer.timeout` */
  readonly signal: AbortSignal;
}

export interface TransformerDef {
  name: string;
  phase: Phase;
  /** Option keys consumed by this transformer – fed into the cache key */
  props: string[];
  /** Must run after this transformer (same phase) */
  after?: string;
  handles: (ctx: TransformContext) => boolean | Promise<boolean>;
  transform: (ctx: TransformContext) => Promise<void>;
}

/** OCR engine. Core ships Tesseract; modules may register better engines (e.g. AI vision). */
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

export interface TranscriptWord {
  word: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface TranscriptSegment {
  start?: number;
  end?: number;
  text: string;
  speaker?: string;
  confidence?: number;
  notes?: string[];
  words?: TranscriptWord[];
}

export interface Transcript {
  kind: 'qino.transcript';
  version: 1;
  text: string;
  language?: string;
  segments: TranscriptSegment[];
}

export interface TranscriptEngine {
  name: string;
  priority: number;
  available: (ctx: TransformContext) => boolean | Promise<boolean>;
  transcribe: (mediaPath: string, mime: string, ctx: TransformContext) => Promise<Transcript>;
}

export interface TransformResult {
  path: string;
  mime: string;
  /** false = original returned (no transform or error) */
  transformed: boolean;
  /** Cache key = content identity (source + options), stable across mtime touches – usable as ETag */
  key?: string;
  error?: Error;
}
