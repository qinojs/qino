import { html, type App, type HtmlString } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { status } from "../cron/mod.ts";

type JobStatus = Awaited<ReturnType<typeof status>>[number];

/** active / running / failed, as shown in the card head and the dashboard widget. */
export function counts(jobs: JobStatus[]) {
  const active = jobs.filter((job) => job.active);
  return { active: active.length, running: active.filter((job) => job.running).length, failed: active.filter((job) => job.failures).length };
}

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card -full">
    <div class=-head>
      <span>${t`Cron jobs`}</span>
      <button type=button data-run-due>${t`Run due jobs`}</button>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <u2-table cms-part=list>${list(node)}</u2-table>
  </div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  return renderJobs(node.app, await status(node.app));
}

export async function renderJobs(app: App, jobs: JobStatus[]): Promise<HtmlString> {
  const { active, running, failed } = counts(jobs);
  const rows = await Promise.all(jobs.map((job) => renderRow(app, job)));

  return html.async`<div class=-body>
    <b>${active}</b> ${app.t`active jobs`}
    · ${running} ${app.t`running`}
    · ${failed} ${app.t`failed`}
  </div>
  <table class="u2-table -jobs -Sticky">
    <thead><tr>
      <th>${app.t`Job`}
      <th>${app.t`Schedule`}
      <th>${app.t`State`}
      <th>${app.t`Next run`}
      <th>${app.t`Last started`}
      <th>${app.t`Last finished`}
      <th>${app.t`Last success`}
      <th>${app.t`Duration`}
      <th>${app.t`Failures`}
      <th>
    <tbody>${html.join(rows)}
  </table>`;
}

async function renderRow(app: App, job: JobStatus): Promise<HtmlString> {
  const due = job.active && !job.running && job.nextRun <= Date.now() / 1000;
  const [state, stateColor] = await stateInfo(app, job, due);
  const error = job.lastError ? html`<details><summary>${await app.t`Last error`}</summary><div class=-error>${job.lastError}</div></details>` : "";
  const action = job.active
    ? html`<button type=button data-run-job="${job.id}" ${job.running ? "disabled" : ""}
        u2-confirm="${await app.t`Run this job now?`}">${await app.t`Run now`}</button>`
    : "";

  return html.async`<tr ${job.active ? "" : "data-inactive"}>
    <td><code>${job.id}</code>
    <td>${cadence(job)}
    <td class=-state><span class=u2-badge style="background:${stateColor}">${state}</span>${error}
    <td>${time(job.nextRun)}
    <td>${time(job.lastStarted)}
    <td>${time(job.lastFinished)}
    <td>${time(job.lastSuccess)}
    <td>${job.durationMs == null ? "–" : html`${job.durationMs} ms`}
    <td>${job.failures}
    <td>${action}`;
}

async function stateInfo(app: App, job: JobStatus, due: boolean) {
  if (!job.active) return [await app.t`inactive`, "var(--gray)"] as const;
  if (job.running) return [await app.t`running`, "var(--blue)"] as const;
  if (job.failures) return [await app.t`failed`, "var(--red)"] as const;
  if (due) return [await app.t`due`, "var(--orange)"] as const;
  return [await app.t`waiting`, "var(--green)"] as const;
}

function cadence(job: JobStatus): HtmlString {
  if (!job.active) return html`–`;
  const every = typeof job.every === "number" ? duration(job.every) : job.every;
  const at = typeof job.every === "number" ? "" : ` · at ${atText(job)}`;
  const jitter = job.jitter ? ` · jitter ±${duration(job.jitter)}` : "";
  return html`<code>every ${every}${at}${jitter}</code><br><small>timeout ${duration(job.timeout!)}</small>`;
}

function atText(job: JobStatus): string {
  const at = job.at ?? {};
  const two = (value: number | undefined) => String(value ?? 0).padStart(2, "0");
  if (job.every === "hour") return `:${two(at.minute)}:${two(at.second)}`;
  const time = `${two(at.hour)}:${two(at.minute)}:${two(at.second)}`;
  return job.every === "week" ? `${at.weekday ?? "monday"} ${time}` : time;
}

function time(value?: number): HtmlString {
  if (!value) return html`–`;
  return html`<u2-time datetime="${new Date(value * 1000).toISOString()}" second type=relative></u2-time>`;
}

function duration(seconds: number): string {
  if (!seconds) return "0s";
  const parts: string[] = [];
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    const value = Math.floor(seconds / size);
    if (value) parts.push(`${value}${unit}`);
    seconds %= size;
  }
  return parts.join(" ");
}
