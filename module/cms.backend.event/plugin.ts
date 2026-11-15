import { backend } from "@qino/qino/cms.backend";
import { get } from "@qino/qino/cms.event";

import api from "./nodeApi.ts";
import render, { list } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, manifest.name, { en: "Events", de: "Veranstaltungen" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, manifest.name);
}

/** Every event is edited here, whatever module shows it. */
export async function backendEdit(node: Node) {
  if (await get(node)) return node.app.t.in(manifest.name)`Edit event in the backend`;
}

export const cms = { node: { render, parts: { list }, api, js: ["pub/main.js"], css: ["pub/main.css"] } };
