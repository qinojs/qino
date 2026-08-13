import type { App } from "@qino/qino";

export { healthChecks } from "./healthChecks.ts";

import { backend, renderDashboard } from "./mod.ts";

export async function install({ app }: { app: App }): Promise<void> {
  const p = await backend.checkInstalled(app);
  p && await p.title("en", "Backend");
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
