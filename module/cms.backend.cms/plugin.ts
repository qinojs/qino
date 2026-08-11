import { backend, renderDashboard } from "../cms.backend/mod.ts";
import type { App } from "../core/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "CMS", de: "CMS" });
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
