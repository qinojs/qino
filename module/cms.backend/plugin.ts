import type { App } from "../core/mod.ts";

export { healthChecks } from "./healthChecks.ts";

export const name = "cms.backend";
export const needs = ["cms"];

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
