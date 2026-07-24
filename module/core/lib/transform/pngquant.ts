import { probe } from "./tryCommand.ts";

export const available = probe('pngquant', ['--version']);

/** Quantizes a PNG to `--quality min-max`. Returns false if pngquant declined (non-zero exit,
 *  e.g. quality unreachable) — expected, not an error; the caller keeps the original. */
export async function run(input: string, output: string, quality: string, signal?: AbortSignal): Promise<boolean> {
  const { code } = await new Deno.Command('pngquant', {
    args: ['--quality', quality, '--strip', '--output', output, input],
    signal,
    stdout: 'piped', stderr: 'piped',
  }).output();
  return code === 0;
}
