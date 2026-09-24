import { backend } from "@qino/qino/cms.backend";

import { applySpeed, evaluate, record } from "./lib/eval.ts";
import api from "./nodeApi.ts";
import { list, render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

const { name } = manifest;

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "AI evaluation", de: "KI-Bewertung" });
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("ai1:call", (e) => record(app, e), { signal });
}

// Sources change slowly; the measured speed is folded in more often.
export const cron = {
  evaluate: { every: "day", at: { hour: 4 }, jitter: 60 * 60, timeout: 5 * 60, run: (app: App) => evaluate(app) },
  speed: { every: "hour", run: (app: App) => applySpeed(app) },
} satisfies Jobs;

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
    parts: { list },
  },
};
