import type { App } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Shop", de: "Shop" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = { node: { render: renderDashboard } };
