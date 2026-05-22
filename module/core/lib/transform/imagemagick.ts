/** Thin wrapper around ImageMagick (IM6: convert/identify, IM7: magick) */

let _checked = false;
let _available: boolean | null = null;
let _avifSupported: boolean | null = null;

// Wird in checkMagick() gesetzt
let _convertCmd = 'magick';         // IM6: 'convert',  IM7: 'magick'
let _identifyCmd = 'magick';        // IM6: 'identify', IM7: 'magick'
let _identifyArgs: string[] = ['identify']; // IM6: [],  IM7: ['identify']

async function tryCommand(cmd: string, args: string[]): Promise<boolean> {
  try {
    const { code } = await new Deno.Command(cmd, {
      args,
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    return code === 0;
  } catch {
    return false;
  }
}

export async function isMagickAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  if (await tryCommand('magick', ['-version'])) {
    _available = true;
  } else if (await tryCommand('convert', ['-version'])) {
    _available = true;
  } else {
    _available = false;
  }
  return _available;
}

export async function checkMagick(): Promise<void> {
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
    throw new Error('ImageMagick not found. Solution: sudo apt install imagemagick');
  }

  _available = true;
  _checked = true;
}

export async function checkAvifSupport(): Promise<boolean> {
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

/** Runs convert/magick [input, ...args, output] */
export async function magick(input: string, args: string[], output: string): Promise<void> {
  const { code, stderr, stdout } = await new Deno.Command(_convertCmd, {
    args: [input, ...args, output],
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
export async function magickIdentify(input: string, format: string): Promise<string> {
  const { stdout } = await new Deno.Command(_identifyCmd, {
    args: [..._identifyArgs, '-format', format, `${input}[0]`],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return new TextDecoder().decode(stdout).trim();
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await Deno.stat(path)).size;
  } catch {
    return Infinity;
  }
}
