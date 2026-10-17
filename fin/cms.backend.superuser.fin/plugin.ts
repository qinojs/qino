import { html, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import { today } from "@qino/qino/fin";

import { amounts, badge, inFin } from "./mod.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Finance", de: "Finanzen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/** The overview: what is open now, how the parts work together, and which parts are there. */
function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Now`}</div>
    ${figures(node.app)}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`How it works`}</div>
    <div><ol>
      <li>${t`An invoice is a claim. Paying it is a payment whose ref is the invoice: fin.invoice:7.`}
      <li>${t`A payment is started at a provider (Saferpay's page, a QR bill) or recorded by hand.`}
      <li>${t`Only the provider says how it stands: return, notification, statement and a job ask it again.`}
      <li>${t`A bank line whose reference is a payment's external id settles it; the rest is assigned by hand.`}
      <li>${t`Each change fires payment:change; the invoice adds up what moved and is open or paid.`}
    </ol></div>
  </div>
  <div class=u2-card style="flex:1 1 100%">
    <div class=-head>${t`Modules`}</div>
    <div style="overflow:auto; max-height:70vh; padding:0">${modules(node.app)}</div>
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
    const open = (direction: string) => app.db.query`
      SELECT currency, SUM(total - paid) AS amount FROM invoice
      WHERE direction = ${direction} AND status = 'open' GROUP BY currency ORDER BY currency`;
    const overdue = Number(await app.db.one`
      SELECT COUNT(*) FROM invoice WHERE direction = 'out' AND type = 'invoice' AND status = 'open'
        AND due < ${today()}`);
    rows.push(
      await row(t`Receivables open`, amounts(await open("out"))),
      await row(t`Overdue`, overdue ? await badge(overdue, "--red") : "0"),
      await row(t`Payables open`, amounts(await open("in"))),
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

/** Every linked fin module with its role, what it builds on, and what it says it does. */
async function modules(app: App) {
  const t = app.t;
  const fin = app.modules.linked().filter((mod) => mod.name.startsWith("fin."));
  const role = (mod: (typeof fin)[number]) =>
    mod.plugin.paymentProvider ? t`payment provider`
      : mod.name.startsWith("fin.bank.") ? t`importer`
      : /\.[a-z]{2}$/.test(mod.name) ? t`country`
      : t`core`;
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Module`}
      <th>${t`Role`}
      <th>${t`Builds on`}
      <th>${t`Does`}
    <tbody>${fin.map((mod) => html.async`<tr>
      <td><code>${mod.name}</code>
      <td>${role(mod)}
      <td>${html.join(mod.dependencies.filter((d) => d.startsWith("fin.")).map((d) => html`<code>${d}</code>`), " ")}
      <td>${mod.description}`)}
  </table>`;
}

export const cms = { node: { render: inFin(render) } };
