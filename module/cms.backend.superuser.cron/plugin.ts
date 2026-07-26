import { html, type App, type HtmlString } from "../core/mod.ts";
import { status } from "../cron/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { render, list } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.cron";
export const needs = ["cms.backend", "cron"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Cron jobs", de: "Cron-Jobs" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const jobs = await status(app);
  const active = jobs.filter((job) => job.active);
  const running = active.filter((job) => job.running).length;
  const failed = active.filter((job) => job.failures).length;
  const [jobsLabel, runningLabel, failedLabel] = await Promise.all([app.t`jobs`, app.t`running`, app.t`failed`]);
  return html`<div class=-body>
    <b>${active.length}</b> ${jobsLabel}
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
