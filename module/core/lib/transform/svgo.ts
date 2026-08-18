/** Thin wrapper around svgo */
import { probe } from "./tryCommand.ts";

export const available = probe('svgo', ['--version']);

/** Minifies an SVG; `precision` = digits kept in path coordinates. */
export async function run(input: string, output: string, precision: number, signal?: AbortSignal): Promise<boolean> {
  const { code } = await new Deno.Command('svgo', {
    args: ['-q', '-i', input, '-o', output, '-p', String(precision), '--multipass'],
    signal, stdout: 'piped', stderr: 'piped',
  }).output();
  return code === 0;
}
