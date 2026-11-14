import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import render, { list } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, manifest.name, { en: "Events", de: "Veranstaltungen" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, manifest.name);
}

export const cms = { node: { render, parts: { list }, api, js: ["pub/main.js"], css: ["pub/main.css"] } };
