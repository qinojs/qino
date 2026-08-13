import dbSchema from "./dbschema.json" with { type: "json" };
import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import { backend } from "@qino/qino/cms.backend";
import { pruneHistory } from "./lib/changes.ts";
import { runScheduled } from "./lib/monitor.ts";
import api from "./nodeApi.ts";
import { render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export { backendDashboardWidget } from "./render.ts";

export { dbSchema };

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
  // The history is a change log: an hourly check that found the same as the one before it says
  // nothing a week later, so it goes and the entry that dated the state stays.
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
