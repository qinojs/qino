/** Thin wrapper around FFmpeg */
import { probe } from "./tryCommand.ts";
import { limited } from './limit.ts';

export const available = probe('ffmpeg', ['-version']);

/** Write an audio file's cover art to `output` in its original format (usually JPEG).
 *  Throws if there is none. */
export async function coverArt(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await limited(() => new Deno.Command('ffmpeg', {
    args: ['-i', input, '-an', '-vcodec', 'copy', '-y', output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output());
  if (code !== 0) {
    throw new Error(`FFmpeg error (cover art): ${new TextDecoder().decode(stderr).trim()}`);
  }
}

/** Write one video frame to `output`; the format follows its extension. */
export async function frame(
  input: string,
  frameIndex: number, // 0-based
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  const { code, stderr } = await limited(() => new Deno.Command('ffmpeg', {
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
  }).output());
  if (code !== 0) {
    throw new Error(
      `FFmpeg Error: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}

export async function audio(input: string, output: string, signal?: AbortSignal): Promise<void> {
  const { code, stderr } = await limited(() => new Deno.Command('ffmpeg', {
    args: ['-i', input, '-map', '0:a:0', '-vn', '-acodec', 'aac', '-b:a', '128k', '-y', output],
    signal,
    stdout: 'piped',
    stderr: 'piped',
  }).output());
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr).trim();
    if (/Stream map.*matches no streams|Output file does not contain any stream/.test(msg))
      throw new Error('FFmpeg error (audio): video has no audio stream');
    throw new Error(`FFmpeg error (audio): ${msg}`);
  }
}
