import { FileTransformer } from '../FileTransformer.ts';
import { magickIdentify } from '../imagemagick.ts';

/**
 * Decode-Phase: Erkennt animierte GIFs und sperrt weitere Transformationen.
 * Animierte GIFs können nicht ohne Frame-Verlust gecroppt/resized werden.
 */
FileTransformer.register({
  name: 'gif-guard',
  phase: 'decode',
  props: [],
  handles: (ctx) => ctx.mime === 'image/gif',
  transform: async (ctx) => {
    const frames = await magickIdentify(ctx.currentPath, '%n');
    if (parseInt(frames) > 1) {
      ctx.meta.animated = true;
    }
  },
});
