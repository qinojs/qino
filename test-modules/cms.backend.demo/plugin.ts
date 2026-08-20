import { backend } from "@qino/qino/cms.backend";

import { wipe } from "./mod.ts";
import { render, status } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Demo data", de: "Demo-Daten" });
}

/** Uninstalling takes the demo data with it — it belongs to the module, not to the site. */
export async function uninstall({ app }: { app: App }): Promise<void> {
  await wipe(app);
  await backend.uninstall(app, name);
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { status },
  },
};
