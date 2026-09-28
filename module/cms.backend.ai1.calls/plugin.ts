import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const LIMIT = 100;
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "AI calls", de: "KI-Aufrufe" });
}

async function render(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const usage = await db.query`
    SELECT m.name AS model, p.name AS provider, s.calls, s.errors, s.calls - s.errors AS successful, s.used_input, s.used_output,
      (s.used_input * mp.cost_input + s.used_output * mp.cost_output) / 1000000.0 AS estimated_cost
    FROM ai1_model_provider mp
    JOIN ai1_model m ON m.id = mp.model_id
    JOIN ai1_provider p ON p.id = mp.provider_id
    JOIN ai1_model_provider_stat s ON s.model_provider_id = mp.id
    ORDER BY s.errors DESC, m.name, p.name`;
  const errors = await db.query`
    SELECT e.time, m.name AS model, p.name AS provider, e.capability, e.message
    FROM ai1_call_error e
    JOIN ai1_model_provider mp ON mp.id = e.model_provider_id
    JOIN ai1_model m ON m.id = mp.model_id
    JOIN ai1_provider p ON p.id = mp.provider_id
    ORDER BY e.id DESC LIMIT ${LIMIT}`;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Usage`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Model`}
          <th>${t`Provider`}
          <th>${t`Calls`}
          <th>${t`Successful`}
          <th>${t`Input`}
          <th>${t`Output`}
          <th>${t`Est. cost`}
          <th>${t`Errors`}
        <tbody>${usage.length ? usage.map((row) => html`<tr>
          <th>${row.model}
          <td>${row.provider}
          <td>${number(row.calls)}
          <td><progress value="${row.successful}" max="${Math.max(1, Number(row.calls))}"></progress> ${number(row.successful)} / ${number(row.calls)}
          <td>${number(row.used_input)}
          <td>${number(row.used_output)}
          <td>${row.estimated_cost == null ? "–" : Number(row.estimated_cost).toLocaleString("en-US", { maximumSignificantDigits: 4 })}
          <td>${number(row.errors)}`) : html`<tr><td colspan=8>${t`No calls yet`}`}</tbody>
      </table>
      <small>${t`Estimated from current prices and provider-reported units; not an invoice.`}</small>
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Recent errors`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Time`}
          <th>${t`Model`}
          <th>${t`Provider`}
          <th>${t`Capability`}
          <th>${t`Error`}
        <tbody>${errors.length ? errors.map((row) => html`<tr>
          <td>${u2.el.time(row.time)}
          <td>${row.model}
          <td>${row.provider}
          <td>${row.capability}
          <td>${row.message}`) : html`<tr><td colspan=5>${t`No errors yet`}`}</tbody>
      </table>
    </div>
  </div>`;
}

export const cms = { node: { render } };
