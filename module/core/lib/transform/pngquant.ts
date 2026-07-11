import { tryCommand } from "./tryCommand.ts";

let _available: boolean | null = null;

async function isAvailable(): Promise<boolean> {
  _available ??= await tryCommand('pngquant', ['--version']);
  return _available;
}

export function resetPngquantCache(): void { _available = null; }
export function isPngquantAvailable(): Promise<boolean> { return isAvailable(); }
