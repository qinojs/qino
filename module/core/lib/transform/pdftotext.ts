/** Thin wrapper around pdftotext (Poppler) */

import { probe } from "./tryCommand.ts";

export const available = probe('pdftotext', ['-v']);

/** Extracts plain text from a PDF (layout preserved) */
export async function run(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('pdftotext', {
    args: ['-layout', '-enc', 'UTF-8', input, output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`pdftotext error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
