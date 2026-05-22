// deno-lint-ignore-file no-explicit-any
import { dbSchema, settingsSchema } from "./schema.ts";
import { initSecurity } from "./guard.ts";
import { backendDashboardWidget, render } from "./view.ts";

export const name = "cms.backend.security";
export const needs = ["cms.backend"];
export { dbSchema, settingsSchema };

export function init(app: any) {
  initSecurity(app);
}

export async function install({ app }: any): Promise<void> {
  const mod = "../cms.backend/mod.ts";
  const { backend } = await import(mod);
  const P = await backend.install(app, name);
  const s = app.settings["cms.backend.security"];
  for (const [key, meta] of Object.entries(settingsSchema.properties as Record<string, { default: unknown }>)) {
    const v = await s[key]; if (v == null || v === "") await s[key](meta.default);
  }
}

export { backendDashboardWidget };

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render } };
