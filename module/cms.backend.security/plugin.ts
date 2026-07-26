import { dbSchema, settingsSchema } from "./schema.ts";
import { initSecurity } from "./guard.ts";
import { cleanup, settings } from "./store.ts";
import { backendDashboardWidget, render } from "./view.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Jobs } from "../cron/mod.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.backend.security";
export const needs = ["cms.backend", "cron"];
export { dbSchema, settingsSchema };

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
  await backend.install(app, name, { en: "Security", de: "Sicherheit" });
  const s = app.settings["cms.backend.security"];
  for (const [key, meta] of Object.entries(settingsSchema.properties)) {
    const v = await s[key]; if (v == null || v === "") await s[key](meta.default);
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
