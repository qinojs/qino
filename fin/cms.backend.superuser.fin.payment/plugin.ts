import { html, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { amounts } from "@qino/qino/cms.backend.superuser.fin";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Payments", de: "Zahlungen" });
}

/** What came in during the last 30 days, and what is still waiting. */
export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const month = unixTime() - 30 * 86400;
  const [moved, waiting] = await Promise.all([
    app.db.query`SELECT currency, SUM(paid - refunded) AS amount FROM payment
      WHERE direction = 'in' AND changed > ${month} AND paid > 0 GROUP BY currency ORDER BY currency`,
    app.db.one`SELECT COUNT(*) FROM payment WHERE status IN ('pending', 'processing')`.then(Number),
  ]);
  return html.async`<div>
    ${amounts(moved)} <small>${app.t`in, 30 days`}</small><br>
    <b>${waiting}</b> ${app.t`waiting`}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
