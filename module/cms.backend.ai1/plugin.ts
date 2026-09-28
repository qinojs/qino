import { backend } from "@qino/qino/cms.backend";

import { evaluate } from "./lib/sources.ts";
import api from "./nodeApi.ts";
import { render, view, widget } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "AI", de: "KI" });
}

// Models, their data and benchmarks change slowly: daily.
export const cron = {
  import: { every: "day", at: { hour: 4 }, jitter: 60 * 60, timeout: 10 * 60, run: (app: App) => evaluate(app) },
} satisfies Jobs;

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return widget(app);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
    parts: { view },
  },
};
