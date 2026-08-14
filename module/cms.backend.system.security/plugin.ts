import { backend } from "@qino/qino/cms.backend";

import { settingsSchema } from "./schema.ts";
import { initSecurity } from "./guard.ts";
import { cleanup, settings } from "./store.ts";
import { backendDashboardWidget, render } from "./view.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

const { name } = manifest;

export { dbSchema } from "./schema.ts";
export { settingsSchema };

export const cron = {
  cleanup: {
    every: "day",
    at: { hour: 4 },
    jitter: 2 * 60 * 60,
    run: async (app) => { await cleanup(app.db, await settings(app)); },
  },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }) {
  initSecurity(app, signal);
}

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.system");
  await backend.install(app, name, { en: "Security", de: "Sicherheit" });
  // Written out, not left to the schema: the admin has to see every knob to turn it down.
  const s = app.settings[name];
  for (const [key, meta] of Object.entries(settingsSchema.properties)) {
    const value = await s[key];
    if (value == null || value === "") await s[key](meta.default);
  }
}

export { backendDashboardWidget };

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
