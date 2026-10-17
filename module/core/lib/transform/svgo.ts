/** Thin wrapper around svgo */
import { sys } from "../sys.ts";
import { probe } from "./tryCommand.ts";

export const available = probe('svgo', ['--version']);

/** Minifies an SVG; `precision` = digits kept in path coordinates. */
export async function run(input: string, output: string, precision: number, signal?: AbortSignal): Promise<boolean> {
  const { code } = await sys.command('svgo', {
    args: ['-q', '-i', input, '-o', output, '-p', String(precision), '--multipass'],
    signal, stdout: 'piped', stderr: 'piped',
  });
  return code === 0;
}
