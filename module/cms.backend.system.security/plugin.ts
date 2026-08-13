import { dbSchema, settingsSchema } from "./schema.ts";
import { initSecurity } from "./guard.ts";
import { cleanup, settings } from "./store.ts";
import { backendDashboardWidget, render } from "./view.ts";
import { backend } from "@qino/qino/cms.backend";
import { cms as cmsApp } from "@qino/qino/cms";
import type { Jobs } from "@qino/qino/cron";
import type { App } from "@qino/qino";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;
const oldName = "cms.backend.security";

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
  const parent = await backend.install(app, "cms.backend.system");
  const cm = cmsApp(app);
  const old = await cm.nodeByModule(oldName);
  if (parent && old) {
    const page = await old.page();
    await app.db.table("page").update(old.id, { module: name });
    if (page) await app.db.table("page").update(page.id, { basis: parent.id });
    cm.clearCache(old.id);
    if (page) cm.clearCache(page.id);
  }
  await backend.install(app, name, { en: "Security", de: "Sicherheit" });
  const s = app.settings[name];
  const legacy = app.settings[oldName];
  for (const [key, meta] of Object.entries(settingsSchema.properties)) {
    const oldValue = await legacy[key];
    if (oldValue != null && oldValue !== "") await s[key](oldValue);
    else {
      const value = await s[key];
      if (value == null || value === "") await s[key](meta.default);
    }
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
