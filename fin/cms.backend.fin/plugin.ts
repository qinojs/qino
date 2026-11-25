import { html, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";

import { amounts, badge, inFin, openInvoices, overdueInvoices } from "./mod.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.fin", name);
  await backend.install(app, name, { en: "Finance", de: "Finanzen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** The overview: what is open now, then each part's card with what to act on. */
function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Now`}</div>
    ${figures(node.app)}
  </div>
  ${renderDashboard(node)}
</div>`;
}

/** What is open and what moved, per currency. Each figure only where its module is linked. */
async function figures(app: App) {
  const t = app.t;
  const month = unixTime() - 30 * 86400;
  const rows: HtmlString[] = [];
  const row = (label: Promise<string> | string, value: HtmlString | string | number) =>
    html.async`<tr><th>${label}<td>${value}`;
  if (app.modules.linked("fin.invoice")) {
    const overdue = await overdueInvoices(app);
    rows.push(
      await row(t`Receivables open`, amounts(await openInvoices(app, "out"))),
      await row(t`Overdue`, overdue ? await badge(overdue, "--red") : "0"),
      await row(t`Payables open`, amounts(await openInvoices(app, "in"))),
    );
  }
  if (app.modules.linked("fin.payment")) {
    const moved = (direction: string) => app.db.query`
      SELECT currency, SUM(paid - refunded) AS amount FROM payment
      WHERE direction = ${direction} AND changed > ${month} AND paid > 0 GROUP BY currency ORDER BY currency`;
    const waiting = Number(await app.db.one`SELECT COUNT(*) FROM payment WHERE status IN ('pending', 'processing')`);
    rows.push(
      await row(t`In, 30 days`, amounts(await moved("in"))),
      await row(t`Out, 30 days`, amounts(await moved("out"))),
      await row(t`Payments waiting`, waiting),
    );
  }
  if (app.modules.linked("fin.bank")) {
    const unassigned = Number(await app.db.one`SELECT COUNT(*) FROM bank_tx WHERE payment_id IS NULL`);
    rows.push(await row(t`Bank lines unassigned`, unassigned));
  }
  return html`<table class=u2-table>${rows}</table>`;
}

export const cms = { node: { render: inFin(render) } };
