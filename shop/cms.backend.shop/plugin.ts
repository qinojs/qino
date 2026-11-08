import { html, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import { shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Shop", de: "Shop" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** Orders waiting for payment and what came in during the last 30 days, per currency. */
async function figures(app: App): Promise<HtmlString> {
  const t = shopT(app), month = unixTime() - 30 * 86400;
  const [open, sold] = await Promise.all([
    app.db.one`SELECT COUNT(*) FROM shop_order WHERE status = ${"ordered"}`.then(Number),
    app.db.query`SELECT currency, COUNT(*) AS n, SUM(total) AS total FROM shop_order
      WHERE status IN ('ordered', 'paid') AND ordered > ${month} GROUP BY currency ORDER BY currency`,
  ]);
  return html.async`<table class=u2-table>
    <tr><th>${t`Waiting for payment`}<td>${open}
    ${sold.map((r) => html.async`<tr><th>${r.currency}, 30 ${t`days`}<td>${Number(r.n)} / ${(Number(r.total) / 100).toFixed(2)}`)}
  </table>`;
}

function render(node: Node): Promise<HtmlString> {
  const t = shopT(node.app);
  return html.async`<div class=u2-flex>
  <div class=u2-card>
    <div class=-head>${t`Now`}</div>
    ${figures(node.app)}
  </div>
  ${renderDashboard(node)}
</div>`;
}

export const cms = { node: { render } };
export const backendDashboardWidget = figures;
