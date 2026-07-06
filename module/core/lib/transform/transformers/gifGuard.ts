import { FileTransformer } from '../FileTransformer.ts';
import { magickIdentify } from '../imagemagick.ts';

/**
 * Decode phase: detects animated GIFs and blocks further transformations.
 * Animated GIFs cannot be cropped/resized without frame loss.
 */
FileTransformer.register({
  name: 'gif-guard',
  phase: 'decode',
  props: [],
  handles: (ctx) => ctx.mime === 'image/gif',
  transform: async (ctx) => {
    const frames = await magickIdentify(ctx.currentPath, '%n', ctx.signal);
    if (parseInt(frames) > 1) {
      ctx.meta.animated = true;
    }
  },
});
