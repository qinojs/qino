import { errMsg, fs } from "@qino/qino";

import { browser } from "./lib/browser.ts";

import type { App } from "@qino/qino";

/**
 * HTML in, PDF out — printed by a headless Chromium, so what works in a page works here: CSS,
 * fonts, SVG, `@page` for size and margins. Relative URLs have no base; use absolute ones or a
 * `<base href>`.
 */
export async function render(app: App, html: string, { timeout = 30_000 } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const cmd = await browser(app);
  if (!cmd) throw new Error("pdf: no Chromium found — install one or set pdf.browser");
  const tmp = app.modules.get("pdf")!.tmp;
  await fs.mkdir(tmp);
  const dir = await fs.tempDir({ dir: tmp });
  try {
    await fs.write(`${dir}/in.html`, html);
    // async, so a missing binary (thrown synchronously by `output()`) becomes a rejection
    const print = async () => await new Deno.Command(cmd, {
      args: [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-pdf-header-footer",
        // its own profile: runs side by side, and the service user has no home
        `--user-data-dir=${dir}/profile`,
        `--print-to-pdf=${dir}/out.pdf`,
        ...asRoot() ? ["--no-sandbox"] : [],
        `file://${dir}/in.html`,
      ],
      stdout: "null",
      stderr: "piped",
      signal: AbortSignal.timeout(timeout),
    }).output();
    const { success, stderr } = await print().catch((e) => {
      throw new Error(`pdf: ${cmd} did not run — ${errMsg(e)}`);
    });
    const out = await fs.bytes(`${dir}/out.pdf`).catch(() => undefined);
    if (!success || !out?.length) {
      throw new Error(`pdf: ${cmd} failed — ${new TextDecoder().decode(stderr).trim().slice(-300)}`);
    }
    return out;
  } finally {
    await fs.remove(dir, { recursive: true });
  }
}

/** Chromium refuses its sandbox as root. Reading the uid needs `--allow-sys`; without it, assume not. */
function asRoot() {
  try {
    return Deno.uid() === 0;
  } catch {
    return false;
  }
}
