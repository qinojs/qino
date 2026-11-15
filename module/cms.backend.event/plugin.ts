import { backend } from "@qino/qino/cms.backend";

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

/** Any node with dates, and every event, is edited here. */
export async function backendEdit(node: Node) {
  if (node.vs.module !== "cms.cont.event" && !await node.db.one`SELECT id FROM cms_event WHERE node_id = ${node.id} LIMIT 1`) return;
  return { title: await node.app.t.in(manifest.name)`Edit event in the backend`, params: { event: node.id } };
}

export const cms = { node: { render, parts: { list }, api, js: ["pub/main.js"], css: ["pub/main.css"] } };
