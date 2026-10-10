/** Thin wrapper around librsvg's rsvg-convert */
import { sys } from "../sys.ts";
import { probe } from "./tryCommand.ts";

export const available = probe('rsvg-convert', ['--version']);

/** Renders an SVG to PNG at exactly `w`x`h` pixels. */
export async function run(input: string, output: string, w: number, h: number, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await sys.command('rsvg-convert', {
    args: ['-w', String(w), '-h', String(h), '-o', output, input],
    signal, stdout: 'piped', stderr: 'piped',
  });
  if (code !== 0) throw new Error(`rsvg-convert error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
