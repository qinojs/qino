import { FileTransformer } from '../FileTransformer.ts';
import { isFfmpegAvailable, ffmpegFrame } from '../ffmpeg.ts';
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
 * Decode phase: extracts one frame of a video as PNG.
 * The normal image pipeline (resize, encode) can then take over.
 *
 * Option `frame` (1-based, default: 1) – which frame to extract.
 */
FileTransformer.register({
  name: 'video-decode',
  phase: 'decode',
  props: ['frame'],
  handles: async (ctx) =>
    await isFfmpegAvailable() &&
    VIDEO_MIMES.has(ctx.mime) &&
    (ctx.options.w !== undefined || ctx.options.h !== undefined || ctx.options.frame !== undefined || ctx.options.fmt !== undefined || ctx.options.q !== undefined),
  transform: async (ctx) => {
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
