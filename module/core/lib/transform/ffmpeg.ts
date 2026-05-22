/** Thin wrapper around FFmpeg */

let _available: boolean | null = null;

async function tryCommand(cmd: string, args: string[]): Promise<boolean> {
  try {
    const { code } = await new Deno.Command(cmd, {
      args,
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    return code === 0;
  } catch {
    return false;
  }
}

export async function isFfmpegAvailable(): Promise<boolean> {
  _available ??= await tryCommand('ffmpeg', ['-version']);
  return _available;
}

export async function checkFfmpeg(): Promise<void> {
  if (!await isFfmpegAvailable()) {
    throw new Error('FFmpeg not found. Solution: sudo apt install ffmpeg');
  }
}

/** Extracts cover art from an audio file and writes it as PNG to `output`.
 *  Throws an error if no cover art is embedded. */
export async function ffmpegCoverArt(input: string, output: string): Promise<void> {
  const { code, stderr } = await new Deno.Command('ffmpeg', {
    args: ['-i', input, '-an', '-vcodec', 'copy', '-y', output],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    throw new Error(`FFmpeg error (cover art): ${new TextDecoder().decode(stderr).trim()}`);
  }
}

/** Extracts a single frame from a video and writes it as PNG to `output` */
export async function ffmpegFrame(
  input: string,
  frameIndex: number, // 0-based
  output: string,
): Promise<void> {
  const { code, stderr } = await new Deno.Command('ffmpeg', {
    args: [
      '-i', input,
      '-vf', `select=eq(n\\,${frameIndex})`,
      '-vframes', '1',
      '-y',
      output,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    throw new Error(
      `FFmpeg Fehler: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}
