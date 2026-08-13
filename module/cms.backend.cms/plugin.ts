import { backend, renderDashboard } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "CMS", de: "CMS" });
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
