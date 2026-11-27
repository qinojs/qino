import { html, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Superuser", de: "Superuser" });
}

/** What is new in the last day, one line per sub-page that is there and may be seen: a count and its page. */
const LINES: [module: string, label: (app: App) => Promise<string>, count: (app: App, since: number) => Promise<unknown>][] = [
  ["cms.backend.superuser.messaging", (app) => app.t`new messages`, (app, since) => app.db.one`SELECT COUNT(*) FROM message
    WHERE direction = ${"in"} AND time >= ${since} AND (spam IS NULL OR spam < ${0.5})`],
  ["cms.backend.superuser.error_report", (app) => app.t`new errors`, (app, since) => app.db.one`SELECT COUNT(*) FROM m_error_report
    WHERE prio = ${"error"} AND time >= ${since}`],
  ["cms.backend.superuser.requests", (app) => app.t`clients`, (app, since) => app.db.one`SELECT COUNT(*) FROM (SELECT client_id FROM log
    WHERE time >= ${since} AND client_id IS NOT NULL GROUP BY client_id HAVING COUNT(*) > 1) c`], // more than one request: no bots passing by
  ["cms.backend.superuser.security.tickets", (app) => app.t`outstanding tickets`, (app) => app.db.one`SELECT COUNT(*) FROM ticket
    WHERE used < uses AND (expires IS NULL OR expires >= ${unixTime()})`],
];

export function backendDashboardWidget(app: App, page: Node): Promise<HtmlString> {
  const since = unixTime() - 86400;
  const line = async ([module, label, count]: typeof LINES[number]) => {
    const target = await (await page.cms.nodeByModule(module))?.page();
    if (!target || !await target.access()) return "";
    const n = Number(await count(app, since).catch(() => 0));
    return html.async`<tr u2-href><td>${n}<td><a href="${backend.toUrl(await target.url())}">${label(app)}</a>`;
  };
  return app.t.with(name, () => html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">${LINES.map(line)}</table>
</div>`);
}

export const cms = {
  node: {
    render: renderDashboard,
  },
};
