import type { App } from "../../module/core/mod.ts";
import { backend, renderDashboard } from "../../module/cms.backend/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Shop", de: "Shop" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = { node: { render: renderDashboard } };
