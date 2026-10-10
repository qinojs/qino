import { sys } from "../sys.ts";
import { probe } from "./tryCommand.ts";

export const available = probe('pngquant', ['--version']);

/** Quantize a PNG to `--quality min-max`. Returns false if pngquant declines (e.g. quality not
 *  reachable) — not an error; the caller keeps the original. */
export async function run(input: string, output: string, quality: string, signal?: AbortSignal): Promise<boolean> {
  const { code } = await sys.command('pngquant', {
    args: ['--quality', quality, '--strip', '--output', output, input],
    signal,
    stdout: 'piped', stderr: 'piped',
  });
  return code === 0;
}
