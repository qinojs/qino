import { backend, renderDashboard } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Locale", de: "Locale" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = { node: { render: renderDashboard } };
