import * as nodePath from 'node:path';
import { ffmpegAudio, isFfmpegAvailable } from '../ffmpeg.ts';
import type { TransformerDef } from '../types.ts';
import { AUDIO_MIMES } from './audioDecode.ts';
import { VIDEO_MIMES } from './videoDecode.ts';

export const TRANSCRIPT_MIME = 'application/vnd.qino.transcript+json';

export const transcript: TransformerDef = {
  name: 'transcript',
  phase: 'decode',
  props: ['fmt'],
  handles: (ctx) =>
    (ctx.options.fmt === 'json' || ctx.options.fmt === 'md') &&
    (AUDIO_MIMES.has(ctx.mime) || VIDEO_MIMES.has(ctx.mime)),
  transform: async (ctx) => {
    const engine = await ctx.transformer.transcriptEngine(ctx);
    if (!engine) throw new Error('transcript: no speech-to-text engine available');
    let path = ctx.currentPath;
    let mime = ctx.mime;
    if (VIDEO_MIMES.has(mime)) {
      if (!await isFfmpegAvailable()) throw new Error('transcript: ffmpeg missing for video audio extraction');
      path = nodePath.join(ctx.tmpDir, 'transcript-audio.m4a');
      await ffmpegAudio(ctx.currentPath, path, ctx.signal);
      mime = 'audio/mp4';
    }
    const out = nodePath.join(ctx.tmpDir, 'transcript.json');
    await Deno.writeTextFile(out, JSON.stringify(await engine.transcribe(path, mime, ctx)));
    ctx.currentPath = out;
    ctx.mime = TRANSCRIPT_MIME;
  },
};
