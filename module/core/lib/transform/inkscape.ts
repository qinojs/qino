/** Thin wrapper around Inkscape's CLI export – SVG fallback with wider SVG 2 coverage than librsvg */
import { probe } from "./tryCommand.ts";

export const available = probe('inkscape', ['--version']);

/** Renders an SVG to PNG at exactly `w`x`h` pixels. */
export async function run(input: string, output: string, w: number, h: number, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('inkscape', {
    args: ['--export-type=png', `--export-filename=${output}`, '-w', String(w), '-h', String(h), input],
    signal, stdout: 'piped', stderr: 'piped',
  }).output();
  if (code !== 0) throw new Error(`Inkscape error: ${new TextDecoder().decode(stderr).trim() || `exit code ${code}`}`);
}
