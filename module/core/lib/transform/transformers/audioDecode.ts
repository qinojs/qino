import { FileTransformer } from '../FileTransformer.ts';
import { checkFfmpeg, ffmpegCoverArt } from '../ffmpeg.ts';
import * as nodePath from 'node:path';

const AUDIO_MIMES = new Set([
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

FileTransformer.register({
  name: 'audio-decode',
  phase: 'decode',
  props: [],
  handles: (ctx) =>
    AUDIO_MIMES.has(ctx.mime) &&
    (ctx.options.w !== undefined || ctx.options.h !== undefined || ctx.options.fmt !== undefined || ctx.options.q !== undefined),
  transform: async (ctx) => {
    await checkFfmpeg();
    const out = nodePath.join(ctx.tmpDir, 'audio-cover.png');
    await ffmpegCoverArt(ctx.currentPath, out);
    ctx.currentPath = out;
    ctx.mime = 'image/png';
  },
});
