import { html, type App, type HtmlString, getCtx } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { currency } from "../locale.currency/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.locale.currency";
export const description = "The exchange rates, and whether the daily job keeps them current.";
export const needs = ["cms.backend.superuser.locale", "locale.currency"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Currencies", de: "Währungen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

const EVERY = ["never", "daily", "hourly"] as const;
const label = (t: App["t"], every: string) => every === "hourly" ? t`every hour` : every === "daily" ? t`once a day` : t`never`;

const showTime = (t: number) => t ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : "";

/** Rates are stored as units per 1 USD — the base the PHP original's source used. */
async function render(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const lang = getCtx().lang;
  const set = app.settings["locale.currency"];
  const every = String(await set.update ?? "never");
  const rows = await app.db.query`SELECT id, rate_to_usd FROM currency`;
  // The option labels are translations, so they are resolved before they land in a fragment.
  const options = await Promise.all(EVERY.map(async (v) =>
    html`<option value=${v} ${v === every ? html.raw("selected") : ""}>${await label(t, v)}`
  ));

  // A rate the job would overwrite on its next run is shown, not offered for editing.
  const byHand = every === "never";
  const collator = new Intl.Collator(lang);
  const named = rows.map((vs) => ({ vs, title: currency.name(String(vs.id), lang) }));
  named.sort((a, b) =>
    Number(b.vs.rate_to_usd != null) - Number(a.vs.rate_to_usd != null) || collator.compare(a.title, b.title)
  );

  const trs = named.map(({ vs, title }) => {
    const id = String(vs.id);
    const symbol = currency.symbol(id, lang);
    return html`<tr itemid=${id}>
    <td>${id}
    <td>${title}
    <td>${symbol === id ? "" : symbol}
    <td>${byHand
      ? html`<input class=-rate type=number step=any value="${vs.rate_to_usd == null ? "" : Number(vs.rate_to_usd)}">`
      : vs.rate_to_usd == null ? "" : Number(vs.rate_to_usd).toPrecision(6)}`;
  });

  return html.async`<div class=u2-card style="flex:0 1 auto">
  <div class=-head>
    ${t`Exchange rates`}
  </div>
  <div class=-body>
    <label>
      ${t`Fetch the rates`}
      <select class=-every>${options}</select>
    </label>
    <p>
      <button class=-now>${t`Update now`}</button>
      <small class=-state>${await set.updated
        ? `${await t`last`} ${showTime(Number(await set.updated))} · ${await set.source}`
        : await t`never fetched`}</small>
    </p>
  </div>
  <div><input type=search class=-search placeholder="${t`Search`}…"></div>
  <div style="max-height:31rem; overflow:auto; padding:0">
    <table class=u2-table>
      <thead style="position:sticky; top:0">
        <tr>
          <th> ISO
          <th> ${await t`Currency`}
          <th> ${await t`Symbol`}
          <th> ${await t`Per 1 USD`}
      <tbody>${trs}
    </table>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const { t, db } = app;
  const set = app.settings["locale.currency"];
  const every = String(await set.update ?? "never");
  return html.async`<div class=-body>
  ${t`Fetch the rates`}: ${label(t, every)}<br>
  <small>${db.one`SELECT count(*) FROM currency WHERE rate_to_usd IS NOT NULL`.catch(() => 0)} ${t`rates`}, ${await set.updated ? showTime(Number(await set.updated)) : await t`never fetched`}</small>
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
