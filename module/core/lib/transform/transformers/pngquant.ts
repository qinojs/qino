import { FileTransformer } from '../FileTransformer.ts';
import * as nodePath from 'node:path';

let _available: boolean | null = null;
async function isAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  try { _available = (await new Deno.Command('pngquant', { args: ['--version'], stdout: 'piped', stderr: 'piped' }).output()).code === 0; }
  catch { _available = false; }
  return _available;
}

FileTransformer.register({
  name: 'pngquant',
  phase: 'encode',
  after: 'image-encode',
  props: ['q'],
  handles: (ctx) => ctx.mime === 'image/png',
  transform: async (ctx) => {
    if (!await isAvailable()) return;
    const q = Math.min(Math.max(ctx.options.q ?? 77, 1), 100);
    const min = Math.max(1, q - 20);
    const out = nodePath.join(ctx.tmpDir, 'out.pngquant.png');
    const proc = new Deno.Command('pngquant', {
      args: ['--quality', `${min}-${q}`, '--strip', '--output', out, ctx.currentPath],
      stdout: 'piped', stderr: 'piped',
    });
    const { code } = await proc.output();
    if (code === 0) ctx.currentPath = out;
  },
});
