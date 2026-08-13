import { backend, renderDashboard } from "@qino/qino/cms.backend";
import type { App } from "@qino/qino";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Configuration", de: "Konfiguration" });
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
