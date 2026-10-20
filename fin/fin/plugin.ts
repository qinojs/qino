import { isOn } from "@qino/qino";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export const settingsSchema = {
  properties: {
    mainCurrency: {
      type: "string",
      maxLength: 3,
      description: "The main currency, ISO 4217: the books keep it, new forms suggest it. "
        + "Empty: the one of the country the organization is in (identity)",
    },
  },
};

export function healthChecks(app: App) {
  return {
    warning: {
      // the books and customers' money: a password alone should not open them
      "sign-in without a second factor": async () => {
        if (isOn(await app.settings.core.loginTwoFactor)) return;
        return {
          info: "core.loginTwoFactor is off: a password alone signs in to the finances",
          solutions: { "ask for a second factor": { solve: async () => { await app.settings.core.loginTwoFactor(true); } } },
        };
      },
    },
  };
}
