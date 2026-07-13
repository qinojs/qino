/** Thin wrapper around Pandoc (document → markdown conversion) */

import { tryCommand } from "./tryCommand.ts";

let _available: boolean | null = null;

export async function isPandocAvailable(): Promise<boolean> {
  return _available ??= await tryCommand('pandoc', ['--version']);
}

export function resetPandocCache(): void { _available = null; }

/** Converts input (format `from`) to GitHub-flavored Markdown */
export async function pandoc(input: string, from: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('pandoc', {
    args: ['-f', from, '-t', 'gfm-raw_html', '--wrap=none', '-o', output, input],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`Pandoc error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
