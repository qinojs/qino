import { backend, renderDashboard } from "./mod.ts";

import type { App } from "@qino/qino";

export { healthChecks } from "./healthChecks.ts";


export async function install({ app }: { app: App }): Promise<void> {
  const p = await backend.checkInstalled(app);
  p && await p.title("en", "Backend");
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
