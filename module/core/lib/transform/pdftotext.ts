/** Thin wrapper around pdftotext (Poppler) */
import { sys } from "../sys.ts";
import { probe } from "./tryCommand.ts";

export const available = probe('pdftotext', ['-v']);

/** Extracts plain text from a PDF (layout preserved) */
export async function run(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await sys.command('pdftotext', {
    args: ['-layout', '-enc', 'UTF-8', input, output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  });
  if (code !== 0) throw new Error(`pdftotext error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
