/** Thin wrapper around librsvg's rsvg-convert */
import { probe } from "./tryCommand.ts";

export const available = probe('rsvg-convert', ['--version']);

/** Renders an SVG to PNG at exactly `w`x`h` pixels. */
export async function run(input: string, output: string, w: number, h: number, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('rsvg-convert', {
    args: ['-w', String(w), '-h', String(h), '-o', output, input],
    signal, stdout: 'piped', stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`rsvg-convert error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
