import { FileTransformer } from '../FileTransformer.ts';
import { magick, magickIdentify, checkAvifSupport, fileSize } from '../imagemagick.ts';
import * as nodePath from 'node:path';

/**
 * Encode-Phase: Wählt optimales Ausgabeformat (AVIF > JPEG > PNG) und setzt Qualität.
 * Läuft nur wenn Geometrie angewendet wurde oder explizit q/fmt gesetzt ist.
 */
FileTransformer.register({
  name: 'image-encode',
  phase: 'encode',
  props: ['q', 'fmt'],
  handles: (ctx) =>
    ctx.mime.startsWith('image/') &&
    ctx.mime !== 'image/svg+xml' &&
    (ctx.meta.geometryApplied || ctx.options.q !== undefined || ctx.options.fmt !== undefined),
  transform: async (ctx) => {
    const q = Math.min(Math.max(ctx.options.q ?? 77, 1), 100);
    const fmt = ctx.options.fmt === 'jpg' ? 'jpeg' : (ctx.options.fmt ?? 'auto');

    // Explizites Format angefordert
    if (fmt !== 'auto') {
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      const out = nodePath.join(ctx.tmpDir, `out.${ext}`);
      await magick(ctx.currentPath, ['-quality', String(q)], out);
      ctx.currentPath = out;
      ctx.mime = mimeForFmt(fmt);
      return;
    }

    // Alpha-Kanal prüfen
    const alphaFlag = await magickIdentify(ctx.currentPath, '%A');
    ctx.meta.hasAlpha = alphaFlag === 'True';

    const avifAvailable = await checkAvifSupport();

    if (avifAvailable) {
      // AVIF unterstützt Alpha nativ – AVIF vs JPEG, kleinere Datei gewinnt
      const avif = nodePath.join(ctx.tmpDir, 'out.avif');
      const jpg = nodePath.join(ctx.tmpDir, 'out.jpg');
      await Promise.all([
        magick(ctx.currentPath, ['-quality', String(q)], avif),
        magick(ctx.currentPath, ['-quality', String(q)], jpg),
      ]);
      const [sizeAvif, sizeJpg] = await Promise.all([fileSize(avif), fileSize(jpg)]);
      if (sizeAvif <= sizeJpg) {
        ctx.currentPath = avif;
        ctx.mime = 'image/avif';
      } else {
        ctx.currentPath = jpg;
        ctx.mime = 'image/jpeg';
      }
    } else if (ctx.meta.hasAlpha) {
      // Kein AVIF, Alpha vorhanden → PNG
      const out = nodePath.join(ctx.tmpDir, 'out.png');
      await magick(ctx.currentPath, ['-quality', String(q)], out);
      ctx.currentPath = out;
      ctx.mime = 'image/png';
    } else {
      // Kein AVIF, kein Alpha → JPEG vs PNG, kleinere gewinnt
      const jpg = nodePath.join(ctx.tmpDir, 'out.jpg');
      const png = nodePath.join(ctx.tmpDir, 'out.png');
      await Promise.all([
        magick(ctx.currentPath, ['-quality', String(q)], jpg),
        magick(ctx.currentPath, [], png),
      ]);
      const [sizeJpg, sizePng] = await Promise.all([fileSize(jpg), fileSize(png)]);
      if (sizeJpg <= sizePng) {
        ctx.currentPath = jpg;
        ctx.mime = 'image/jpeg';
      } else {
        ctx.currentPath = png;
        ctx.mime = 'image/png';
      }
    }
  },
});

function mimeForFmt(fmt: string): string {
  return { avif: 'image/avif', jpeg: 'image/jpeg', png: 'image/png' }[fmt] ?? 'application/octet-stream';
}
