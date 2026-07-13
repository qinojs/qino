import { tryCommand } from "./tryCommand.ts";

let _available: boolean | null = null;

export async function isPngquantAvailable(): Promise<boolean> {
  _available ??= await tryCommand('pngquant', ['--version']);
  return _available;
}

export function resetPngquantCache(): void { _available = null; }
