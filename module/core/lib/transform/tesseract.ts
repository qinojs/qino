/** Thin wrapper around Tesseract OCR */

let _available: boolean | null = null;
let _langs: Promise<string> | null = null;

export async function isTesseractAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  _available = await new Deno.Command('tesseract', { args: ['--version'], stdout: 'piped', stderr: 'piped' }).output()
    .then((r) => r.code === 0, () => false);
  return _available;
}

export function resetTesseractCache(): void { _available = null; _langs = null; }

/** All installed languages joined for -l (e.g. "deu+eng"), 'osd' excluded */
function tesseractLangs(): Promise<string> {
  return _langs ??= (async () => {
    const { stdout } = await new Deno.Command('tesseract', { args: ['--list-langs'], stdout: 'piped', stderr: 'piped' }).output();
    return new TextDecoder().decode(stdout).split('\n').slice(1) // first line is a header
      .map((l) => l.trim()).filter((l) => l && l !== 'osd').join('+');
  })();
}

/** Runs OCR on an image, returns the extracted plain text */
export async function tesseract(input: string, signal?: AbortSignal): Promise<string> {
  const langs = await tesseractLangs();
  const { code, stdout, stderr } = await new Deno.Command('tesseract', {
    args: [input, 'stdout', ...(langs ? ['-l', langs] : [])],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`tesseract error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
  return new TextDecoder().decode(stdout);
}
