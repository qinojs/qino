/** Thin wrapper around Pandoc (document → markdown conversion) */

let _available: boolean | null = null;

export async function isPandocAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  try { _available = (await new Deno.Command('pandoc', { args: ['--version'], stdout: 'piped', stderr: 'piped' }).output()).code === 0; }
  catch { _available = false; }
  return _available;
}

export function resetPandocCache(): void { _available = null; }

/** Converts input (format `from`) to GitHub-flavored Markdown */
export async function pandoc(input: string, from: string, output: string): Promise<void> {
  const { code, stderr } = await new Deno.Command('pandoc', {
    args: ['-f', from, '-t', 'gfm-raw_html', '--wrap=none', '-o', output, input],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`Pandoc error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
