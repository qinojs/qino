import { backend, renderDashboard } from "../cms.backend/mod.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.backend.superuser.locale";
export const description = "Groups the reference data panels — countries, currencies, rates.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Locale", de: "Locale" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export const cms = { node: { render: renderDashboard } };
