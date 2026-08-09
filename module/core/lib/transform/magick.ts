/** Thin wrapper around ImageMagick (IM6: convert/identify, IM7: magick) */
import { tryCommand } from "./tryCommand.ts";

let _checked = false;
let _available: boolean | null = null;
let _avifSupported: boolean | null = null;

let _convertCmd = 'magick';
let _identifyCmd = 'magick';
let _identifyArgs: string[] = ['identify'];


export async function available(): Promise<boolean> {
  if (_available !== null) return _available;
  return checkMagick().then(() => true).catch(() => false);
}

async function checkMagick(): Promise<void> {
  if (_checked) return;

  if (await tryCommand('magick', ['-version'])) {
    _convertCmd  = 'magick';
    _identifyCmd = 'magick';
    _identifyArgs = ['identify'];
  } else if (await tryCommand('convert', ['-version'])) {
    _convertCmd  = 'convert';
    _identifyCmd = 'identify';
    _identifyArgs = [];
  } else {
    _available = false;
    throw new Error('ImageMagick not found. Solution: sudo api install imagemagick');
  }

  _available = true;
  _checked = true;
}

export async function avifSupported(): Promise<boolean> {
  if (_avifSupported !== null) return _avifSupported;
  await checkMagick().catch(() => { _avifSupported = false; });
  if (_avifSupported !== null) return _avifSupported;
  try {
    const { stdout } = await new Deno.Command(_convertCmd, {
      args: ['-list', 'format'],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    _avifSupported = new TextDecoder().decode(stdout).toUpperCase().includes('AVIF');
  } catch {
    _avifSupported = false;
  }
  return _avifSupported;
}

/** Runs convert/magick [...preArgs, input, ...args, output]. preArgs are input-settings that must precede the file (e.g. -density for PDF rasterization). */
export async function run(input: string, args: string[], output: string, opts: { preArgs?: string[]; signal?: AbortSignal } = {}): Promise<void> {
  const { code, stderr, stdout } = await new Deno.Command(_convertCmd, {
    args: [...opts.preArgs ?? [], input, ...args, output],
    signal: opts.signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    const dec = new TextDecoder();
    const msg = dec.decode(stderr).trim() || dec.decode(stdout).trim() || `exit code ${code}`;
    throw new Error(`ImageMagick error: ${msg}`);
  }
}

/** Returns identify format string, e.g. "%wx%h" → "1920x1080" */
export async function identify(input: string, format: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await new Deno.Command(_identifyCmd, {
    args: [..._identifyArgs, '-format', format, `${input}[0]`],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return new TextDecoder().decode(stdout).trim();
}

export function resetCache(): void {
  _checked = false;
  _available = null;
  _avifSupported = null;
  _convertCmd = 'magick';
  _identifyCmd = 'magick';
  _identifyArgs = ['identify'];
}
