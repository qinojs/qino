let _available: boolean | null = null;

async function isAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  _available = await new Deno.Command('pngquant', { args: ['--version'], stdout: 'piped', stderr: 'piped' }).output()
    .then((r) => r.code === 0, () => false);
  return _available;
}

export function resetPngquantCache(): void { _available = null; }
export function isPngquantAvailable(): Promise<boolean> { return isAvailable(); }
