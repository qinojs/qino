import { backend, renderDashboard } from "../cms.backend/mod.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.backend.cms";
export const description = "Provides the main CMS administration dashboard.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "CMS", de: "CMS" });
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
