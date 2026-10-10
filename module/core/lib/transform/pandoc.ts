/** Thin wrapper around Pandoc (document → markdown conversion) */
import { sys } from "../sys.ts";
import { probe } from "./tryCommand.ts";

export const available = probe('pandoc', ['--version']);

/** Converts input (format `from`) to GitHub-flavored Markdown */
export async function run(input: string, from: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await sys.command('pandoc', {
    args: ['-f', from, '-t', 'gfm-raw_html', '--wrap=none', '-o', output, input],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  });
  if (code !== 0) throw new Error(`Pandoc error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
