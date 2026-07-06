/** Thin wrapper around Poppler's pdftotext */

let _available: boolean | null = null;

export async function isPdftotextAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  try { _available = (await new Deno.Command('pdftotext', { args: ['-v'], stdout: 'piped', stderr: 'piped' }).output()).code === 0; }
  catch { _available = false; }
  return _available;
}

export function resetPdftotextCache(): void { _available = null; }

/** Extracts plain text from a PDF (layout preserved) */
export async function pdftotext(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('pdftotext', {
    args: ['-layout', '-enc', 'UTF-8', input, output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`pdftotext error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
