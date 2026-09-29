import { html, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const { uniqueColor, ageColor } = backend;
const LIMIT = 100;
const MESSAGE = 160; // characters of an error shown; all of it on hover
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const cost = (value: unknown) => value == null ? "–" : Number(value).toLocaleString("en-US", { maximumSignificantDigits: 4 });
/** A model or provider in its own color, the same everywhere, to find it again at a glance. */
const colored = (value: unknown) => html`<span style="color:${uniqueColor(value)}">${value}</span>`;
const success = (row: Record<string, unknown>) =>
  html`<progress value="${Number(row.calls) - Number(row.errors)}" max="${Math.max(1, Number(row.calls))}"></progress> ${number(Number(row.calls) - Number(row.errors))} / ${number(row.calls)}`;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "AI calls", de: "KI-Aufrufe" });
}

async function render(node: Node): Promise<HtmlString> {
  const { db, t } = node.app;
  const usage = await db.query`
    SELECT m.name AS model, p.name AS provider, s.calls, s.errors, s.used_input, s.used_output,
      (s.used_input * mp.cost_input + s.used_output * mp.cost_output) / 1000000.0 AS estimated_cost
    FROM ai1_model_provider mp
    JOIN ai1_model m ON m.id = mp.model_id
    JOIN ai1_provider p ON p.id = mp.provider_id
    JOIN ai1_model_provider_stat s ON s.model_provider_id = mp.id
    ORDER BY s.errors DESC, m.name, p.name`;
  const providers = await db.query`
    SELECT p.name AS provider, SUM(s.calls) AS calls, SUM(s.errors) AS errors, SUM(s.used_input) AS used_input, SUM(s.used_output) AS used_output,
      SUM((s.used_input * mp.cost_input + s.used_output * mp.cost_output) / 1000000.0) AS estimated_cost
    FROM ai1_model_provider mp
    JOIN ai1_provider p ON p.id = mp.provider_id
    JOIN ai1_model_provider_stat s ON s.model_provider_id = mp.id
    GROUP BY p.name ORDER BY calls DESC, p.name`;
  const errors = await db.query`
    SELECT e.time, m.name AS model, p.name AS provider, e.capability, e.message
    FROM ai1_call_error e
    JOIN ai1_model_provider mp ON mp.id = e.model_provider_id
    JOIN ai1_model m ON m.id = mp.model_id
    JOIN ai1_provider p ON p.id = mp.provider_id
    ORDER BY e.id DESC LIMIT ${LIMIT}`;
  // the browser API's daily units per user (ai1.api), where it is loaded
  const api = node.app.modules.linked("ai1.api"), limit = api ? Number(await node.app.settings["ai1.api"].dailyLimit) : 0;
  const users = api ? await db.query`SELECT u.username, a.units FROM ai1_usage a LEFT JOIN usr u ON u.id = a.usr_id
    WHERE a.day = ${Math.floor(unixTime() / 86400)} ORDER BY a.units DESC, a.usr_id LIMIT ${LIMIT}` : undefined;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Providers`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Provider`}
          <th>${t`Successful`}
          <th>${t`Errors`}
          <th>${t`Input`}
          <th>${t`Output`}
          <th>${t`Est. cost`}
        <tbody>${providers.length ? providers.map((row) => html`<tr>
          <th>${colored(row.provider)}
          <td>${success(row)}
          <td>${number(row.errors)}
          <td>${number(row.used_input)}
          <td>${number(row.used_output)}
          <td>${cost(row.estimated_cost)}`) : html`<tr><td colspan=6>${t`No calls yet`}`}</tbody>
      </table>
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Models`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Model`}
          <th>${t`Provider`}
          <th>${t`Successful`}
          <th>${t`Errors`}
          <th>${t`Input`}
          <th>${t`Output`}
          <th>${t`Est. cost`}
        <tbody>${usage.length ? usage.map((row) => html`<tr>
          <th>${colored(row.model)}
          <td>${colored(row.provider)}
          <td>${success(row)}
          <td>${number(row.errors)}
          <td>${number(row.used_input)}
          <td>${number(row.used_output)}
          <td>${cost(row.estimated_cost)}`) : html`<tr><td colspan=7>${t`No calls yet`}`}</tbody>
      </table>
      <small>${t`Calls and errors count recent ones more (they halve daily); usage is the total. Cost is estimated from current prices and provider-reported units; not an invoice.`}</small>
    </div>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Recent errors`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Time`}
          <th>${t`Model`}
          <th>${t`Error`}
        <tbody>${errors.length ? errors.map((row) => html`<tr>
          <td style="color:${ageColor(row.time)}; white-space:nowrap">${u2.el.time(row.time, { narrow: true })}
          <td>${colored(row.model)}<br><small>${colored(row.provider)} · ${row.capability}</small>
          <td title="${row.message}"><small>${String(row.message).length > MESSAGE ? String(row.message).slice(0, MESSAGE) + " …" : row.message}</small>`)
          : html`<tr><td colspan=3>${t`No errors yet`}`}</tbody>
      </table>
    </div>
    ${users ? html.async`<div class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Usage today`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`User`}
          <th>${t`Units`}
        <tbody>${users.length ? users.map((row) => html`<tr>
          <th>${colored(row.username)}
          <td>${limit ? html`<progress value="${Math.min(Number(row.units), limit)}" max="${limit}"></progress> ${number(row.units)} / ${number(limit)}` : number(row.units)}`)
          : html.async`<tr><td colspan=2>${t`No usage today`}`}</tbody>
      </table>
      <small>${t`Units (tokens, characters, seconds, images) of each user's requests; at the daily limit the browser API refuses.`}</small>
    </div>` : ""}
  </div>`;
}

export const cms = { node: { render } };
