import type { App } from "../../module/core/mod.ts";
import { backend, renderDashboard } from "../../module/cms.backend/mod.ts";

export const name = "cms.backend.shp3";
export const description = "The shop's backend overview — every shop page shows its numbers here.";
export const needs = ["cms.backend", "shp3"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Shop", de: "Shop" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = { node: { render: renderDashboard } };
