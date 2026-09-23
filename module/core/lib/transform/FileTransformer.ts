import * as nodePath from 'node:path';

import { typeByExtension } from '../../deps.ts';
import { fs } from '../fs.ts';
import { resetProbes } from './tryCommand.ts';
import * as magick from './magick.ts';
import * as ffmpeg from './ffmpeg.ts';
import * as pngquantCli from './pngquant.ts';
import * as rsvg from './rsvg.ts';
import * as inkscape from './inkscape.ts';
import * as svgo from './svgo.ts';
import * as scour from './scour.ts';
import * as pandoc from './pandoc.ts';
import * as pdftotext from './pdftotext.ts';
import * as tesseract from './tesseract.ts';
import { tesseractEngine } from './ocr.ts';
import { gifGuard } from './transformers/gifGuard.ts';
import { pdfDecode } from './transformers/pdfDecode.ts';
import { svgDecode } from './transformers/svgDecode.ts';
import { videoDecode } from './transformers/videoDecode.ts';
import { audioDecode } from './transformers/audioDecode.ts';
import { transcript } from './transformers/transcript.ts';
import { markdown } from './transformers/markdown.ts';
import { ocr } from './transformers/ocr.ts';
import { imageResize } from './transformers/imageResize.ts';
import { imageEncode } from './transformers/imageEncode.ts';
import { svgOptimize } from './transformers/svgOptimize.ts';
import { pngquant } from './transformers/pngquant.ts';

import type { OcrEngine, Phase, TransformerDef, TransformContext, TransformOptions, TransformResult, TranscriptEngine } from './types.ts';

const PHASE_ORDER: Phase[] = ['decode', 'geometry', 'encode'];

/** Built-in transformers (array order = registration order within a phase) */
export const builtinTransformers: TransformerDef[] =
  [gifGuard, pdfDecode, svgDecode, transcript, videoDecode, audioDecode, markdown, ocr, imageResize, imageEncode, svgOptimize, pngquant];

/** Framework-agnostic transform pipeline: per-instance transformers, OCR engines, cache dir and timeout. */
export class FileTransformer {
  /** Directory for cached transform results (created lazily) */
  cacheDir: string;
  /** Max seconds per transform pipeline; external commands are killed on expiry */
  timeout: number;
  #transformers: TransformerDef[] = [];
  #running = new Map<string, Promise<TransformResult>>();
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

  static readonly capabilities: Readonly<Record<'magick' | 'ffmpeg' | 'avif' | 'pngquant' | 'pandoc' | 'pdftotext' | 'tesseract' | 'rsvg' | 'inkscape' | 'svgo' | 'scour', Promise<boolean>>> = {
    get magick(): Promise<boolean> { return magick.available(); },
    get ffmpeg(): Promise<boolean> { return ffmpeg.available(); },
    get avif(): Promise<boolean> { return magick.avifSupported(); },
    get pngquant(): Promise<boolean> { return pngquantCli.available(); },
    get pandoc(): Promise<boolean> { return pandoc.available(); },
    get pdftotext(): Promise<boolean> { return pdftotext.available(); },
    get tesseract(): Promise<boolean> { return tesseract.available(); },
    get rsvg(): Promise<boolean> { return rsvg.available(); },
    get inkscape(): Promise<boolean> { return inkscape.available(); },
    get svgo(): Promise<boolean> { return svgo.available(); },
    get scour(): Promise<boolean> { return scour.available(); },
  };

  static resetCapabilityCache(): void {
    resetProbes();       // ffmpeg, pngquant, pandoc, pdftotext, tesseract, rsvg, inkscape, svgo, scour
    magick.resetCache(); // special-cased (IM6/IM7 command detection)
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

  /** The installed tools change the output (AVIF or JPEG, rsvg or inkscape, svgo or scour,
   *  pngquant, OCR engine) but are no options, so they go into the cache key separately — otherwise
   *  a newly installed tool would reuse old entries. Covers every entry of `capabilities`, plus the
   *  engines with their priority. */
  async #toolchain(): Promise<string> {
    const caps = FileTransformer.capabilities as Readonly<Record<string, Promise<boolean>>>;
    const tools = await Promise.all(Object.keys(caps).sort().map(async (k) => `${k}=${await caps[k] ? 1 : 0}`));
    const engines = [...this.#ocrEngines, ...this.#transcriptEngines].map((e) => `${e.name}@${e.priority}`).sort();
    return [...tools, ...engines].join(',');
  }

  async transform(
    sourcePath: string,
    options: TransformOptions,
    knownMime?: string, // MIME type of the source if known (e.g. from DB), else detected by extension
    accept?: string, // the client's `Accept` header; omitted = no constraint
  ): Promise<TransformResult> {
    const opts = { ...options };
    if (opts.dpr && opts.dpr > 1) {
      opts.w &&= Math.round(opts.w * opts.dpr);
      opts.h &&= Math.round(opts.h * opts.dpr);
    }
    delete opts.dpr;

    const ext = nodePath.extname(sourcePath).slice(1).toLowerCase();
    const mime = knownMime || typeByExtension(ext) || 'application/octet-stream';

    // Cache key: source path + size + options used by any transformer + toolchain
    // (no mtime: touched for LRU; no mime: follows from path/content).
    // db-file paths are content hashes (md5); for changing paths a fingerprint is still missing (> 1.0).
    const stat = await fs.stat(sourcePath);
    if (!stat) throw new Error(`FileTransformer: source file not found: ${sourcePath}`);

    const fingerprint = `${sourcePath}-${stat.size}`;
    const knownProps = new Set(this.#transformers.flatMap((t) => t.props));
    const optParts = [...knownProps].sort().flatMap((k) => opts[k] !== undefined ? `${k}=${opts[k]}` : []);
    const cacheKey = await hashKey([fingerprint, ...optParts, await this.#toolchain(), accepts(accept, opts)]);
    const run = async (): Promise<TransformResult> => {
      const cachePath = nodePath.join(this.cacheDir, `tf_${cacheKey}`);
      const metaPath = `${cachePath}.mime`;

      // Check cache hit
      const cacheStat = await fs.stat(cachePath);
      if (cacheStat) {
        const cachedMime = await fs.text(metaPath).catch(() => mime);
        if (Date.now() - (cacheStat.mtime?.getTime() ?? 0) > 86_400_000) fs.touch(cachePath).catch(() => {});
        return { path: cachePath, mime: cachedMime, transformed: true, key: cacheKey };
      } // Cache miss – continue

      const pipeline = sortTransformers(this.#transformers);
      const tmpDir = await fs.tempDir({ prefix: 'filetransform_' });
      const ctx: TransformContext = {
        transformer: this,
        sourcePath,
        currentPath: sourcePath,
        mime,
        options: opts,
        accept,
        meta: {},
        tmpDir,
        signal: AbortSignal.timeout(this.timeout * 1000),
      };

      try {
        for (const transformer of pipeline)
          if (await transformer.handles(ctx)) await transformer.transform(ctx);

        if (ctx.currentPath === sourcePath) {
          return { path: sourcePath, mime, transformed: false, key: cacheKey };
        }

        // Meta first, then move the file into place atomically (readers never see a partial file)
        await fs.mkdir(this.cacheDir);
        await fs.write(metaPath, ctx.mime);
        const partPath = `${cachePath}.part-${crypto.randomUUID()}`;
        await fs.copy(ctx.currentPath, partPath);
        await fs.rename(partPath, cachePath);
        return { path: cachePath, mime: ctx.mime, transformed: true, key: cacheKey };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('[FileTransformer]', err.message);
        return { path: sourcePath, mime, transformed: false, error: err };
      } finally {
        await fs.remove(tmpDir, { recursive: true }).catch(() => {});
      }
    };
    return this.#running.getOrInsertComputed(cacheKey, () =>
      run().finally(() => this.#running.delete(cacheKey))
    );
  }
}

/** Cache key part for the Accept header, so a browser without AVIF never gets the AVIF entry.
 *  Only explicit types count (`image/*` and `*​/*` say nothing about codecs). A missing header is no
 *  constraint and gives the empty string. */
function accepts(accept: string | undefined, opts: TransformOptions): string {
  if (opts.fmt || !accept) return ''; // explicit format, or nothing known
  return NEGOTIATED.filter((type) => !accept.includes(type)).join(',');
}

/** Types the pipeline may pick itself, which a client can rule out. */
const NEGOTIATED = ['image/avif'];

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
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('|')));
  return new Uint8Array(buf).toHex();
}
