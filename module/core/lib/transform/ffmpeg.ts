/** Thin wrapper around FFmpeg */

import { probe } from "./tryCommand.ts";

export const available = probe('ffmpeg', ['-version']);

/** Extracts the embedded cover art from an audio file and writes it to `output`
 *  in its original format (`-vcodec copy`, typically JPEG).
 *  Throws an error if no cover art is embedded. */
export async function coverArt(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('ffmpeg', {
    args: ['-i', input, '-an', '-vcodec', 'copy', '-y', output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    throw new Error(`FFmpeg error (cover art): ${new TextDecoder().decode(stderr).trim()}`);
  }
}

/** Extracts a single frame from a video and writes it to `output`;
 *  the image format is derived from the `output` file extension. */
export async function frame(
  input: string,
  frameIndex: number, // 0-based
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  const { code, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-i', input,
      '-vf', `select=eq(n\\,${frameIndex})`,
      '-vframes', '1',
      '-y',
      output,
    ],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    throw new Error(
      `FFmpeg Error: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}

export async function audio(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await new Deno.Command('ffmpeg', {
    args: ['-i', input, '-map', '0:a:0', '-vn', '-acodec', 'aac', '-b:a', '128k', '-y', output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr).trim();
    if (/Stream map.*matches no streams|Output file does not contain any stream/.test(msg))
      throw new Error('FFmpeg error (audio): video has no audio stream');
    throw new Error(`FFmpeg error (audio): ${msg}`);
  }
}
