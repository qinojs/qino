import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import { models, providers, render, widget } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "AI", de: "KI" });
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return widget(app);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
    parts: { models, providers },
  },
};
