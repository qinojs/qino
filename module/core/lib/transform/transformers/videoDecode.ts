import { FileTransformer } from '../FileTransformer.ts';
import { checkFfmpeg, ffmpegFrame } from '../ffmpeg.ts';
import * as nodePath from 'node:path';

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
]);

/**
 * Decode-Phase: Extrahiert einen Frame aus einem Video als PNG.
 * Danach kann die normale Bild-Pipeline (resize, encode) greifen.
 *
 * Option `frame` (1-basiert, Standard: 1) – welcher Frame extrahiert wird.
 */
FileTransformer.register({
  name: 'video-decode',
  phase: 'decode',
  props: ['frame'],
  handles: (ctx) =>
    VIDEO_MIMES.has(ctx.mime) &&
    (ctx.options.w !== undefined || ctx.options.h !== undefined || ctx.options.frame !== undefined || ctx.options.fmt !== undefined || ctx.options.q !== undefined),
  transform: async (ctx) => {
    await checkFfmpeg();
    const frame = toFrameIndex(ctx.options.frame); // FFmpeg ist 0-basiert
    const out = nodePath.join(ctx.tmpDir, 'video-frame.png');
    await ffmpegFrame(ctx.currentPath, frame, out);
    ctx.currentPath = out;
    ctx.mime = 'image/png';
  },
});

function toFrameIndex(frame: number | undefined): number {
  const value = Math.floor(frame ?? 1);
  return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}
