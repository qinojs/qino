import { open } from "@qino/qino/browser";

import type { App } from "@qino/qino";

/** Chromium's own print defaults: margins where `@page` sets none, backgrounds printed. */
const MARGIN = { top: "0.4in", right: "0.4in", bottom: "0.4in", left: "0.4in" };

/**
 * HTML in, PDF out — printed by a headless Chromium, so what works in a page works here: CSS,
 * fonts, SVG, `@page` for size and margins. Relative URLs have no base; use absolute ones or a
 * `<base href>`.
 */
export async function render(app: App, html: string, { timeout = 30_000 } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const page = await open(app, { guard: false }); // our own html: may load from our own server
  try {
    page.setDefaultTimeout(timeout);
    await page.setContent(html);
    await page.evaluate("document.fonts.ready");
    return new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: MARGIN }));
  } finally {
    await page.close();
  }
}
