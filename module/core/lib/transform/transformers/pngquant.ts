import * as nodePath from 'node:path';

import * as pngquantCli from '../pngquant.ts';

import type { TransformerDef } from '../types.ts';

export const pngquant: TransformerDef = {
  name: 'pngquant',
  phase: 'encode',
  after: 'image-encode',
  props: ['q'],
  handles: (ctx) => ctx.mime === 'image/png' && (!!ctx.meta.geometryApplied || ctx.options.q !== undefined || ctx.options.fmt !== undefined),
  transform: async (ctx) => {
    if (!await pngquantCli.available()) return;
    const q = Math.min(Math.max(ctx.options.q ?? 77, 1), 100);
    const min = Math.max(1, q - 20);
    const out = nodePath.join(ctx.tmpDir, 'out.pngquant.png');
    if (await pngquantCli.run(ctx.currentPath, out, `${min}-${q}`, ctx.signal)) ctx.currentPath = out;
  },
};
