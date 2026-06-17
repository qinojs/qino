import { backend } from "../cms.backend/mod.ts";
import { render } from "./render.ts";
import { collectConflicts } from "./lib/analyze.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.backend.superuser.db";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "DB Manager", de: "DB Manager" });
}

// schema conflicts are pure in-memory analysis of the loaded module schemas — no DB hit
export async function backendDashboardWidget(app: App): Promise<string> {
  const conflicts = collectConflicts(app.modules.all());
  const tables = Object.keys(app.db.schema?.properties ?? {}).length;
  const status = conflicts.length
    ? `<small class=u2-badge style="background:var(--red)">${conflicts.length} ${await app.t`schema conflicts`}</small>`
    : `<span style="color:var(--green)">&#10003; ${await app.t`schema OK`}</span>`;
  return `<div class=-body>${status}<br><small>${tables} ${await app.t`tables`}</small></div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
