import { isFfmpegAvailable, ffmpegCoverArt } from '../ffmpeg.ts';
import type { TransformerDef } from '../types.ts';
import * as nodePath from 'node:path';

export const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/webm',
]);

export const audioDecode: TransformerDef = {
  name: 'audio-decode',
  phase: 'decode',
  props: [],
  handles: async (ctx) =>
    await isFfmpegAvailable() &&
    AUDIO_MIMES.has(ctx.mime) &&
    (ctx.options.w !== undefined || ctx.options.h !== undefined || (ctx.options.fmt !== undefined && ctx.options.fmt !== 'md' && ctx.options.fmt !== 'json') || ctx.options.q !== undefined),
  transform: async (ctx) => {
    const out = nodePath.join(ctx.tmpDir, 'audio-cover.png');
    await ffmpegCoverArt(ctx.currentPath, out, ctx.signal);
    ctx.currentPath = out;
    ctx.mime = 'image/png';
  },
};
