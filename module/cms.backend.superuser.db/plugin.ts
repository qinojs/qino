import { backend } from "../cms.backend/mod.ts";
import { render } from "./render.ts";
import { collectConflicts } from "./lib/analyze.ts";
import { html, type App, type HtmlString } from "../core/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "DB Manager", de: "DB Manager" });
}

// schema conflicts are pure in-memory analysis of the loaded module schemas — no DB hit
export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const conflicts = collectConflicts(app.modules.all());
  const tables = Object.keys(app.db.schema?.properties ?? {}).length;
  const status = conflicts.length
    ? html.async`<small class=u2-badge style="background:var(--red)">${conflicts.length} ${app.t`schema conflicts`}</small>`
    : html.async`<span style="color:var(--green)">&#10003; ${app.t`schema OK`}</span>`;
  return html.async`<div class=-body>${status}<br><small>${tables} ${app.t`tables`}</small></div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
  },
};
