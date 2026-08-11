import { html, type App, type HtmlString } from "../core/mod.ts";
import { status } from "../cron/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { counts, render, list } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Cron jobs", de: "Cron-Jobs" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const { active, running, failed } = counts(await status(app));
  const [jobsLabel, runningLabel, failedLabel] = await Promise.all([app.t`jobs`, app.t`running`, app.t`failed`]);
  return html`<div class=-body>
    <b>${active}</b> ${jobsLabel}
    ${running ? html` · <span class=u2-badge>${running} ${runningLabel}</span>` : ""}
    ${failed ? html` · <span class=u2-badge style="background:var(--red)">${failed} ${failedLabel}</span>` : ""}
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
    parts: { list },
  },
};
