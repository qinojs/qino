/** Thin wrapper around Tesseract OCR */
import { probe } from "./tryCommand.ts";
import { limited } from './limit.ts';

let _langs: Promise<string> | null = null;

export const available = probe('tesseract', ['--version']);
const _resetAvailable = available.reset;
available.reset = () => { _resetAvailable(); _langs = null; };

/** All installed languages joined for -l (e.g. "deu+eng"), 'osd' excluded */
function tesseractLangs(): Promise<string> {
  return _langs ??= (async () => {
    const { stdout } = await new Deno.Command('tesseract', { args: ['--list-langs'], stdout: 'piped', stderr: 'piped' }).output();
    return new TextDecoder().decode(stdout).split('\n').slice(1) // first line is a header
      .map((l) => l.trim()).filter((l) => l && l !== 'osd').join('+');
  })();
}

/** Runs OCR on an image, returns the extracted plain text */
export async function run(input: string, signal?: AbortSignal): Promise<string> {
  const langs = await tesseractLangs();
  const { code, stdout, stderr } = await limited(() => new Deno.Command('tesseract', {
    args: [input, 'stdout', ...(langs ? ['-l', langs] : [])],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output());
  if (code !== 0) throw new Error(`tesseract error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
  return new TextDecoder().decode(stdout);
}
