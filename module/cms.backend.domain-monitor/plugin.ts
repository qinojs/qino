import { backend } from "@qino/qino/cms.backend";

import { pruneHistory } from "./lib/changes.ts";
import { runScheduled } from "./lib/monitor.ts";
import api from "./nodeApi.ts";
import { render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

const { name } = manifest;

export { backendDashboardWidget } from "./render.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const ctxSettingsSchema = {
  properties: {
    cols: { type: "string", description: "Column groups folded away in the overview, comma separated." },
  },
};

export const cron = {
  hourly: {
    every: "hour",
    at: { minute: 30 },
    jitter: 30 * 60,
    run: (app, { signal }) => runScheduled(app, "hourly", signal),
  },
  daily: {
    every: "day",
    at: { hour: 12 },
    jitter: 12 * 60 * 60,
    run: (app, { signal }) => runScheduled(app, "daily", signal),
  },
  weekly: {
    every: "week",
    at: { weekday: "sunday", hour: 4 },
    jitter: 4 * 60 * 60,
    run: (app, { signal }) => runScheduled(app, "weekly", signal),
  },
  // Keep only checks with changes after a week; the first of a series of equal checks stays.
  prune: {
    every: "day",
    at: { hour: 3 },
    jitter: 60 * 60,
    run: (app, { signal }) => pruneHistory(app, { signal }),
  },
} satisfies Jobs;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Domain monitor", de: "Domain-Überwachung" });
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
  },
};
