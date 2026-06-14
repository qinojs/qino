import * as nodePath from 'node:path';
import * as nodeFs from 'node:fs/promises';
import { typeByExtension } from '../../../../deps.ts';
import type { Phase, TransformerDef, TransformContext, TransformOptions, TransformResult } from './types.ts';
import { checkAvifSupport, isMagickAvailable, resetMagickCache } from './imagemagick.ts';
import { isFfmpegAvailable, resetFfmpegCache } from './ffmpeg.ts';
import { resetPngquantCache, isPngquantAvailable } from './pngquant.ts';

const PHASE_ORDER: Phase[] = ['decode', 'geometry', 'filter', 'encode'];

export class FileTransformer {
  static readonly #transformers: TransformerDef[] = [];

  static readonly capabilities: Readonly<Record<'magick' | 'ffmpeg' | 'avif' | 'pngquant', Promise<boolean>>> = {
    get magick(): Promise<boolean> { return isMagickAvailable(); },
    get ffmpeg(): Promise<boolean> { return isFfmpegAvailable(); },
    get avif(): Promise<boolean> { return checkAvifSupport(); },
    get pngquant(): Promise<boolean> { return isPngquantAvailable(); },
  };

  static resetCapabilityCache(): void {
    resetMagickCache();
    resetFfmpegCache();
    resetPngquantCache();
  }

  static register(def: TransformerDef): void {
    if (FileTransformer.#transformers.some((t) => t.name === def.name)) {
      throw new Error(`FileTransformer: Transformer "${def.name}" bereits registriert`);
    }
    FileTransformer.#transformers.push(def);
  }

  static async transform(
    sourcePath: string,
    cacheDir: string,
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

    // Cache-Key: mtime+size der Quelldatei + alle gesetzten Optionen
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(sourcePath);
    } catch {
      throw new Error(`FileTransformer: source file not found: ${sourcePath}`);
    }

    const fingerprint = `${stat.mtime?.getTime() ?? 0}-${stat.size}`;
    const optParts = Object.keys(opts)
      .sort()
      .filter((k) => opts[k] !== undefined)
      .map((k) => `${k}=${opts[k]}`);
    const cacheKey = await hashKey([fingerprint, ...optParts]);
    const cachePath = nodePath.join(cacheDir, `tf_${cacheKey}`);
    const metaPath = `${cachePath}.mime`;

    // Check cache hit
    try {
      const cacheStat = await Deno.stat(cachePath);
      if ((cacheStat.mtime?.getTime() ?? 0) >= (stat.mtime?.getTime() ?? 0)) {
        const cachedMime = await Deno.readTextFile(metaPath).catch(() => mime);
        if (Date.now() - (cacheStat.mtime?.getTime() ?? 0) > 86_400_000) {
          Deno.utime(cachePath, new Date(), new Date()).catch(() => {});
        }
        return { path: cachePath, mime: cachedMime, transformed: true };
      }
    } catch {
      // Cache miss – continue
    }

    const pipeline = sortTransformers(FileTransformer.#transformers);
    const tmpDir = await Deno.makeTempDir({ prefix: 'filetransform_' });
    const ctx: TransformContext = {
      sourcePath,
      currentPath: sourcePath,
      mime,
      options: opts,
      meta: {},
      tmpDir,
    };

    try {
      for (const transformer of pipeline) {
        if (await transformer.handles(ctx)) {
          await transformer.transform(ctx);
        }
      }

      if (ctx.currentPath === sourcePath) {
        return { path: sourcePath, mime, transformed: false };
      }

      await nodeFs.mkdir(cacheDir, { recursive: true });
      await nodeFs.copyFile(ctx.currentPath, cachePath);
      await Deno.writeTextFile(metaPath, ctx.mime);
      return { path: cachePath, mime: ctx.mime, transformed: true };
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
  const result: TransformerDef[] = [];
  for (const phase of PHASE_ORDER) {
    const inPhase = transformers.filter((t) => t.phase === phase);
    result.push(...topoSort(inPhase));
  }
  return result;
}

function topoSort(transformers: TransformerDef[]): TransformerDef[] {
  const names = new Set(transformers.map((t) => t.name));
  const result: TransformerDef[] = [];
  const added = new Set<string>();

  function add(t: TransformerDef) {
    if (added.has(t.name)) return;
    if (t.after && names.has(t.after)) {
      const dep = transformers.find((x) => x.name === t.after);
      if (dep) add(dep);
    }
    result.push(t);
    added.add(t.name);
  }

  for (const t of transformers) add(t);
  return result;
}

async function hashKey(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const buf = await crypto.subtle.digest('SHA-1', data);
  return new Uint8Array(buf).toHex();
}
