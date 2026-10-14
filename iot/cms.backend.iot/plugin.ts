import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import { render, views } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Home automation", de: "Hausautomation" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = {
  node: { render, api, js: ["pub/main.js"], parts: views },
};
