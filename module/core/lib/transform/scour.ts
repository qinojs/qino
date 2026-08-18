/** Thin wrapper around scour – svgo without a Node runtime */
import { probe } from "./tryCommand.ts";

export const available = probe('scour', ['--version']);

/** Minifies an SVG; `precision` = digits kept in path coordinates. */
export async function run(input: string, output: string, precision: number, signal?: AbortSignal): Promise<boolean> {
  const { code } = await new Deno.Command('scour', {
    args: ['-i', input, '-o', output, `--set-precision=${precision}`, '--enable-comment-stripping', '--indent=none', '--quiet'],
    signal, stdout: 'piped', stderr: 'piped',
  }).output();
  return code === 0;
}
