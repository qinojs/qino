import { html, type HtmlString, getCtx, type App } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { backend } from "../../module/cms.backend/mod.ts";
import { country } from "../../module/locale.country/mod.ts";
import { currency } from "../../module/locale.currency/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.shp3.settings";
export const description = "The shop's own address, its currencies, VAT and the countries it delivers to.";
export const needs = ["cms.backend.shp3", "shp3"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Settings", de: "Einstellungen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
  ${await address(node)}
  ${await currencies(node)}
  ${await countries(node)}
</div>`;
}

/** Where the shop stands — the country a price is calculated for before the customer names one. */
async function address(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const lang = getCtx().lang;
  const set = app.settings.shp3;
  const chosen = String(await set.location.country ?? "");
  const options = (await country.sorted(app.db, lang)).map((id) =>
    html`<option value=${id} ${id === chosen ? html.raw("selected") : ""}>${country.name(id, lang)}`
  );

  return html.async`<div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Shop address`}</div>
    <table class=u2-table>
      <tr>
        <th>${t`Country`}
        <td><select class=-set data-setting=location.country><option value="">${html.join(options)}</select>
      <tr>
        <th>${t`City`}
        <td><input class=-set data-setting=location.city value="${await set.location.city}">
      <tr>
        <th>${t`Street`}
        <td><input class=-set data-setting=location.street value="${await set.location.street}">
      <tr>
        <th>${t`VAT`}
        <td><label>
          <input class=-set type=checkbox data-setting=vat.mode ${await set.vat.mode !== "excluded" ? html.raw("checked") : ""}>
          ${await t`Included in the product prices`}
        </label>
    </table>
  </div>`;
}

/** The currencies the shop prices in. The main one is the yardstick, so its factor stays 1. */
async function currencies(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const lang = getCtx().lang;
  // Every currency there is; the shop's own row exists for the ones it prices in.
  const rows = await app.db.query`SELECT c.id, s.factor, s.smallest, s.smallest_closing, s.active, s.main
    FROM currency c LEFT JOIN shp3_currency s ON s.id = c.id`;
  // While rates are fetched, the factors come from locale.currency — editing them here would
  // only survive until the next run.
  const fromRates = String(await app.settings["locale.currency"].update ?? "never") !== "never";

  // A country the shop delivers to pays in its own currency — worth offering.
  const wanted = new Map<string, string[]>();
  for (const c of await app.db.query`SELECT id, currency FROM country WHERE shp3_enabled = ${true} AND currency != ${""}`) {
    wanted.set(String(c.currency), [...wanted.get(String(c.currency)) ?? [], String(c.id)]);
  }

  const collator = new Intl.Collator(lang);
  const named = rows.map((vs) => ({ vs, title: currency.name(String(vs.id), lang) }));
  named.sort((a, b) =>
    Number(!!b.vs.active) - Number(!!a.vs.active) ||
    Number(wanted.has(String(b.vs.id))) - Number(wanted.has(String(a.vs.id))) ||
    collator.compare(a.title, b.title)
  );

  const trs = named.map(({ vs, title }) => {
    const has = vs.factor != null; // no row yet: the shop does not price in it
    const needed = wanted.get(String(vs.id));
    return html`<tr itemid=${vs.id} class="${vs.active ? "-on" : ""}">
    <td>${vs.id} <small>${title}</small>
      ${needed ? html`<small class=-needed>${needed.join(", ")}</small>` : ""}
    <td><input class=-cur data-field=factor type=number step=any value="${has ? vs.factor : ""}" ${vs.main || fromRates || !has ? html.raw("disabled") : ""}>
    <td><input class=-cur data-field=smallest type=number step=any value="${has ? vs.smallest : ""}" ${has ? html.raw("") : html.raw("disabled")}>
    <td><input class=-cur data-field=smallest_closing type=number step=any value="${has ? vs.smallest_closing : ""}" ${has ? html.raw("") : html.raw("disabled")}>
    <td><input class=-cur data-field=active type=checkbox ${vs.active ? html.raw("checked") : ""} ${vs.main ? html.raw("disabled") : ""}>
    <td><input class=-cur data-field=main type=radio name=main ${vs.main ? html.raw("checked") : ""} ${has ? html.raw("") : html.raw("disabled")}>`;
  });

  return html.async`<div class=u2-card style="flex:0 1 auto">
    <div class=-head>
      ${t`Currencies`}
      ${fromRates ? html`<small>${await t`factors follow the exchange rates`}</small>` : ""}
    </div>
    <div><input type=search class=-search placeholder="${t`Search`}…"></div>
    <div style="max-height:31rem; overflow:auto; padding:0">
      <table class=u2-table>
        <thead style="position:sticky; top:0">
          <tr>
            <th> ${t`Currency`}
            <th> ${t`Factor`}
            <th> ${t`Smallest unit`}
            <th> ${t`Smallest total`}
            <th> ${t`Active`}
            <th> ${t`Main`}
        <tbody>${html.join(trs)}
      </table>
    </div>
  </div>`;
}

/** Where the shop delivers to, and what VAT each of those countries carries. */
async function countries(node: Node): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const lang = getCtx().lang;
  const rows = await app.db.query`SELECT id, currency, shp3_enabled, shp3_default_vat_rate FROM country`;
  const collator = new Intl.Collator(lang);
  const named = rows.map((vs) => ({ vs, title: country.name(String(vs.id), lang) }));
  // The ones it sells to first — that is the working set; the rest is what the search is for.
  named.sort((a, b) => Number(b.vs.shp3_enabled) - Number(a.vs.shp3_enabled) || collator.compare(a.title, b.title));

  const trs = named.map(({ vs, title }) => html`<tr itemid=${vs.id} class="${vs.shp3_enabled ? "-on" : ""}">
    <td><label>
      <input class=-country data-field=shp3_enabled type=checkbox ${vs.shp3_enabled ? html.raw("checked") : ""}>
      ${title} <small>${vs.id}${vs.currency ? " · " + vs.currency : ""}</small>
    </label>
    <td><input class=-country data-field=shp3_default_vat_rate type=number step=any style="width:5rem" value="${vs.shp3_default_vat_rate}">`);

  return html.async`<div class=u2-card style="flex:0 1 auto">
    <div class=-head>
      ${t`Countries`}
    </div>
    <div><input type=search class=-search placeholder="${t`Search`}…"></div>
    <div style="max-height:31rem; overflow:auto; padding:0">
      <table class=u2-table>
        <thead style="position:sticky; top:0">
          <tr>
            <th> ${t`Delivers to`}
            <th width=60> ${t`VAT`} %
        <tbody>${html.join(trs)}
      </table>
    </div>
  </div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const { t, db } = app;
  const lang = getCtx().lang;
  const home = String(await app.settings.shp3.location.country ?? "");
  return html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${t`Shop address`}:<td>${home ? country.name(home, lang) : await t`nowhere`}
  <tr><td>${t`Delivers to`}:<td>${db.one`SELECT count(*) FROM country WHERE shp3_enabled = ${true}`.catch(() => 0)} ${t`countries`}
  <tr><td>${t`Currencies`}:<td>${db.one`SELECT count(*) FROM shp3_currency WHERE active = ${true}`.catch(() => 0)}
</table>
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"] } };
