import { backend } from "@qino/qino/cms.backend";

import { renderDetail } from "./detail.ts";
import { api, backendDashboardWidget, renderOverview } from "./stores.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Modules", de: "Module" });
}

function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }) {
  // JS reloads post vars without the query, so keep the acted-on module in view.
  const mod = String(vars.mod ?? vars.disable ?? vars.enable ?? ctx.req.query.mod ?? "");
  return mod ? renderDetail(node, mod, vars) : renderOverview(node);
}

export { backendDashboardWidget };

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api },
};
