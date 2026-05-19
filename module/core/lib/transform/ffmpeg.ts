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
    throw new Error('FFmpeg nicht gefunden. Lösung: sudo apt install ffmpeg');
  }
}

/** Extrahiert Cover-Art aus einer Audio-Datei und schreibt sie als PNG nach `output`.
 *  Wirft einen Fehler wenn keine Cover-Art eingebettet ist. */
export async function ffmpegCoverArt(input: string, output: string): Promise<void> {
  const { code, stderr } = await new Deno.Command('ffmpeg', {
    args: ['-i', input, '-an', '-vcodec', 'copy', '-y', output],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (code !== 0) {
    throw new Error(`FFmpeg Fehler (Cover-Art): ${new TextDecoder().decode(stderr).trim()}`);
  }
}

/** Extrahiert einen einzelnen Frame aus einem Video und schreibt ihn als PNG nach `output` */
export async function ffmpegFrame(
  input: string,
  frameIndex: number, // 0-basiert
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
