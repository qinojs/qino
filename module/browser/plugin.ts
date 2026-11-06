import { errMsg } from "@qino/qino";

import { driver, executable } from "./mod.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";

export const settingsSchema = {
  properties: {
    executable: { type: "string", description: "Chromium to run; the first one installed by default" },
  },
};

export function healthChecks(app: App) {
  return { warning: {
    "no browser": async () => {
      if (!await executable(app)) return { info: "install Chromium (apt install chromium) or set browser.executable" };
      const missing = await driver().then(() => "", errMsg);
      if (missing) return { info: missing };
    },
  } };
}
