// deno-lint-ignore-file no-explicit-any
import { dbSchema } from "./schema.ts";
import { ensureDefaults } from "./store.ts";
import { initSecurity } from "./guard.ts";
import { backendDashboardWidget, render } from "./view.ts";

export const name = "cms.backend.security";
export const needs = ["cms.backend"];
export { dbSchema };

export function init(app: any) {
  initSecurity(app);
}

export async function install({ app }: any): Promise<void> {
  const mod = "../cms.backend/mod.ts";
  const { backend } = await import(mod);
  const P = await backend.install(app, name);
  if (P) { await P.title("en", "Security"); await P.title("de", "Security"); }
  await ensureDefaults(app.db);
}

export { backendDashboardWidget };

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render } };
