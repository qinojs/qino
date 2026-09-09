import { backend, renderDashboard } from "./mod.ts";

import type { App } from "@qino/qino";

export { healthChecks } from "./healthChecks.ts";


export async function install({ app }: { app: App }): Promise<void> {
  const p = await backend.checkInstalled(app);
  // in every language the other backend modules install too, so the page has a name on any site
  if (p) for (const lang of ["en", "de", "fr", "it"]) await p.title(lang, "Backend");
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
