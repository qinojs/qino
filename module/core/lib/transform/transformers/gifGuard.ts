import { magickIdentify } from '../imagemagick.ts';
import type { TransformerDef } from '../types.ts';

/**
 * Decode phase: detects animated GIFs and blocks further transformations.
 * Animated GIFs cannot be cropped/resized without frame loss.
 */
export const gifGuard: TransformerDef = {
  name: 'gif-guard',
  phase: 'decode',
  props: [],
  handles: (ctx) => ctx.mime === 'image/gif',
  transform: async (ctx) => {
    if (parseInt(await magickIdentify(ctx.currentPath, '%n', ctx.signal)) > 1) ctx.meta.animated = true;
  },
};
