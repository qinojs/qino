import { backend, renderDashboard } from "../cms.backend/mod.ts";
import type { App } from "../core/mod.ts";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser", { en: "Superuser", de: "Superuser" });
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
