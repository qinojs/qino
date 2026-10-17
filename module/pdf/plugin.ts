import { browser } from "./lib/browser.ts";

import type { App } from "@qino/qino";

export const settingsSchema = {
  properties: {
    browser: { type: "string", description: "Chromium to print with; the first one installed by default" },
  },
};

export function healthChecks(app: App) {
  return { warning: {
    "no browser to print PDFs": async () => {
      if (await browser(app)) return;
      return { info: "install Chromium (apt install chromium) or set pdf.browser — until then PDFs fail" };
    },
  } };
}
