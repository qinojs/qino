import * as nodePath from 'node:path';
import * as nodeFs from 'node:fs/promises';
import { typeByExtension } from '../../../../deps.ts';
import type { OcrEngine, Phase, TransformerDef, TransformContext, TransformOptions, TransformResult, TranscriptEngine } from './types.ts';
import { checkAvifSupport, isMagickAvailable, resetMagickCache } from './imagemagick.ts';
import { isFfmpegAvailable, resetFfmpegCache } from './ffmpeg.ts';
import { resetPngquantCache, isPngquantAvailable } from './pngquant.ts';
import { resetPandocCache, isPandocAvailable } from './pandoc.ts';
import { resetPdftotextCache, isPdftotextAvailable } from './poppler.ts';
import { resetTesseractCache, isTesseractAvailable } from './tesseract.ts';
import { tesseractEngine } from './ocr.ts';
import { gifGuard } from './transformers/gifGuard.ts';
import { pdfDecode } from './transformers/pdfDecode.ts';
import { videoDecode } from './transformers/videoDecode.ts';
import { audioDecode } from './transformers/audioDecode.ts';
import { transcript } from './transformers/transcript.ts';
import { markdown } from './transformers/markdown.ts';
import { ocr } from './transformers/ocr.ts';
import { imageResize } from './transformers/imageResize.ts';
import { imageEncode } from './transformers/imageEncode.ts';
import { pngquant } from './transformers/pngquant.ts';

const PHASE_ORDER: Phase[] = ['decode', 'geometry', 'filter', 'encode'];

/** Built-in transformers (array order = registration order within a phase) */
export const builtinTransformers: TransformerDef[] =
  [gifGuard, pdfDecode, transcript, videoDecode, audioDecode, markdown, ocr, imageResize, imageEncode, pngquant];

/** Framework-agnostic transform pipeline: per-instance transformers, OCR engines, cache dir and timeout. */
export class FileTransformer {
  /** Directory for cached transform results (created lazily) */
  cacheDir: string;
  /** Max seconds per transform pipeline; external commands are killed on expiry */
  timeout: number;
  #transformers: TransformerDef[] = [];
  #ocrEngines: OcrEngine[] = [];
  #transcriptEngines: TranscriptEngine[] = [];

  constructor(opts: { cacheDir: string; timeout?: number }) {
    this.cacheDir = opts.cacheDir;
    this.timeout = opts.timeout ?? 600;
  }

  /** FileTransformer with all built-in transformers and the Tesseract OCR engine registered */
  static create(opts: { cacheDir: string; timeout?: number }): FileTransformer {
    const transformer = new FileTransformer(opts);
    for (const def of builtinTransformers) transformer.register(def);
    transformer.registerOcrEngine(tesseractEngine);
    return transformer;
  }

  static readonly capabilities: Readonly<Record<'magick' | 'ffmpeg' | 'avif' | 'pngquant' | 'pandoc' | 'pdftotext' | 'tesseract', Promise<boolean>>> = {
    get magick(): Promise<boolean> { return isMagickAvailable(); },
    get ffmpeg(): Promise<boolean> { return isFfmpegAvailable(); },
    get avif(): Promise<boolean> { return checkAvifSupport(); },
    get pngquant(): Promise<boolean> { return isPngquantAvailable(); },
    get pandoc(): Promise<boolean> { return isPandocAvailable(); },
    get pdftotext(): Promise<boolean> { return isPdftotextAvailable(); },
    get tesseract(): Promise<boolean> { return isTesseractAvailable(); },
  };

  static resetCapabilityCache(): void {
    resetMagickCache();
    resetFfmpegCache();
    resetPngquantCache();
    resetPandocCache();
    resetPdftotextCache();
    resetTesseractCache();
  }

  register(def: TransformerDef): void {
    if (this.#transformers.some((t) => t.name === def.name)) {
      throw new Error(`FileTransformer: transformer "${def.name}" already registered`);
    }
    this.#transformers.push(def);
  }

  /** Registers an OCR engine; the highest-priority available one wins in `ocrEngine()` */
  registerOcrEngine(engine: OcrEngine): void {
    this.#ocrEngines.push(engine);
    this.#ocrEngines.sort((a, b) => b.priority - a.priority);
  }

  async ocrEngine(ctx: TransformContext): Promise<OcrEngine | undefined> {
    for (const engine of this.#ocrEngines) if (await engine.available(ctx)) return engine;
  }

  registerTranscriptEngine(engine: TranscriptEngine): void {
    this.#transcriptEngines.push(engine);
    this.#transcriptEngines.sort((a, b) => b.priority - a.priority);
  }

  async transcriptEngine(ctx: TransformContext): Promise<TranscriptEngine | undefined> {
    for (const engine of this.#transcriptEngines) if (await engine.available(ctx)) return engine;
  }

  async transform(
    sourcePath: string,
    options: TransformOptions,
    /** Known MIME type of the source file (e.g. from DB) – fallback to extension detection */
    knownMime?: string,
  ): Promise<TransformResult> {
    const opts = { ...options };
    if (opts.dpr && opts.dpr > 1) {
      opts.w &&= Math.round(opts.w * opts.dpr);
      opts.h &&= Math.round(opts.h * opts.dpr);
    }
    delete opts.dpr;

    const ext = nodePath.extname(sourcePath).slice(1).toLowerCase();
    const mime = knownMime || typeByExtension(ext) || 'application/octet-stream';

    // Cache key: source path + size + all set options consumed by any registered transformer
    // (no mtime: it may be touched on access for LRU tracking; no mime: derivable from path/content)
    // Content fingerprint: for db-files covered by the path (md5 content-addressed).
    // For generic use (mutable paths) something is still to be found (> 1.0).
    const stat = await Deno.stat(sourcePath).catch(() => {
      throw new Error(`FileTransformer: source file not found: ${sourcePath}`);
    });

    const fingerprint = `${sourcePath}-${stat.size}`;
    const knownProps = new Set(this.#transformers.flatMap((t) => t.props));
    const optParts = [...knownProps].sort().flatMap((k) => opts[k] !== undefined ? `${k}=${opts[k]}` : []);
    const cacheKey = await hashKey([fingerprint, ...optParts]);
    const cachePath = nodePath.join(this.cacheDir, `tf_${cacheKey}`);
    const metaPath = `${cachePath}.mime`;

    // Check cache hit
    try {
      const cacheStat = await Deno.stat(cachePath);
      const cachedMime = await Deno.readTextFile(metaPath).catch(() => mime);
      if (Date.now() - (cacheStat.mtime?.getTime() ?? 0) > 86_400_000) {
        Deno.utime(cachePath, new Date(), new Date()).catch(() => {});
      }
      return { path: cachePath, mime: cachedMime, transformed: true, key: cacheKey };
    } catch { /* Cache miss – continue */ }

    const pipeline = sortTransformers(this.#transformers);
    const tmpDir = await Deno.makeTempDir({ prefix: 'filetransform_' });
    const ctx: TransformContext = {
      transformer: this,
      sourcePath,
      currentPath: sourcePath,
      mime,
      options: opts,
      meta: {},
      tmpDir,
      signal: AbortSignal.timeout(this.timeout * 1000),
    };

    try {
      for (const transformer of pipeline) {
        if (await transformer.handles(ctx)) {
          await transformer.transform(ctx);
        }
      }

      if (ctx.currentPath === sourcePath) {
        return { path: sourcePath, mime, transformed: false, key: cacheKey };
      }

      // Write meta first, then move the file atomically into place (concurrent readers never see a partial file)
      await nodeFs.mkdir(this.cacheDir, { recursive: true });
      await Deno.writeTextFile(metaPath, ctx.mime);
      const partPath = `${cachePath}.part-${crypto.randomUUID()}`;
      await nodeFs.copyFile(ctx.currentPath, partPath);
      await nodeFs.rename(partPath, cachePath);
      return { path: cachePath, mime: ctx.mime, transformed: true, key: cacheKey };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[FileTransformer]', err.message);
      return { path: sourcePath, mime, transformed: false, error: err };
    } finally {
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  }
}

/** Sorts transformers by phase order + `after` dependencies within a phase */
function sortTransformers(transformers: TransformerDef[]): TransformerDef[] {
  return PHASE_ORDER.flatMap((phase) => topoSort(transformers.filter((t) => t.phase === phase)));
}

function topoSort(transformers: TransformerDef[]): TransformerDef[] {
  const byName = new Map(transformers.map((t) => [t.name, t]));
  const result: TransformerDef[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  function add(t: TransformerDef) {
    if (state.get(t.name) === 'done') return;
    if (state.get(t.name) === 'visiting') throw new Error(`FileTransformer: circular "after" dependency at "${t.name}"`);
    state.set(t.name, 'visiting');
    const dep = t.after ? byName.get(t.after) : undefined;
    if (dep) add(dep);
    result.push(t);
    state.set(t.name, 'done');
  }

  for (const t of transformers) add(t);
  return result;
}

async function hashKey(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const buf = await crypto.subtle.digest('SHA-1', data);
  return new Uint8Array(buf).toHex();
}
