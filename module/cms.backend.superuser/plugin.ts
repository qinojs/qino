import { backend, renderDashboard } from "@qino/qino/cms.backend";
import type { App } from "@qino/qino";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser", { en: "Superuser", de: "Superuser" });
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
