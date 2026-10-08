import { getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, inputAmount, money, rowLink } from "@qino/qino/cms.backend.superuser.fin";
import { mainCurrency, nameOf, today } from "@qino/qino/fin";
import { horizon, periods, plans, renews, subscriptions } from "@qino/qino/fin.subscription";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const date = (value: unknown) => value ? String(value).slice(0, 10) : "";

const selected = (yes: boolean) => yes ? html.raw(" selected") : "";

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const id = Number(url.searchParams.get("subscription"));
  if (Number.isSafeInteger(id) && id > 0) return detail(node, id);
  const plan = Number(url.searchParams.get("plan"));
  if (Number.isSafeInteger(plan) && plan > 0) return planDetail(node, plan);
  return overview(node, url);
}

/** Every `n units`: "1 year", "3 months". */
const every = (app: App, unit: unknown, count: unknown) =>
  html.async`${Number(count) > 1 ? `${count} ` : ""}${unit === "month" ? app.t`month` : app.t`year`}`;

/** The plan, the price and the period fields of a form; empty ones take the plan's (`placeholder`). */
function terms(app: App, row: Row, catalog: Row[], placeholder: Row = {}) {
  const t = app.t;
  return html.async`
    ${t`Price`} <input name=price inputmode=decimal size=8
      value="${inputAmount(row.price, row.currencyCode || row.currency)}"
      placeholder="${inputAmount(placeholder.price, placeholder.currency)}">
    ${t`Currency`}
    <input name=currency maxlength=3 size=4 value="${row.currency}" placeholder="${placeholder.currency}">
    ${t`Tax %`} <input name=taxRate inputmode=decimal size=4 value="${row.tax_rate}"
      placeholder="${placeholder.tax_rate ?? ""}">
    ${t`Every`} <span><input name=count type=number min=1 style="width:4rem" value="${row.interval_count}"
      placeholder="${placeholder.interval_count ?? ""}">
      <select name=unit><option value="">${catalog.length ? "—" : ""}${["year", "month"].map((u) =>
        html.async`<option value=${u}${selected(row.interval_unit === u)}>${u === "year" ? t`year` : t`month`}`)}
      </select></span>`;
}

/** All subscriptions, the catalog, what the next billing run takes, and new ones. */
async function overview(node: Node, url: URL): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const pageUrl = await (await node.page()).url();
  const usrFilter = Number(url.searchParams.get("usr")) || undefined;
  const [all, catalog, users] = await Promise.all([
    subscriptions(app, usrFilter),
    plans(app),
    app.db.query`SELECT id, given_name, family_name, organization FROM usr ORDER BY family_name, given_name`,
  ]);
  const names = new Map(users.map((u) => [Number(u.id), nameOf(u)]));
  const until = await horizon(app);
  const ended = (s: Row) => s.end_date && String(s.next) >= date(s.end_date);
  const due = all.filter((s) => renews(s, until));
  const userSelect = (name: string) => html`<select name=${name} required><option value="">—${users.map((u) =>
    html`<option value="${u.id}"${selected(Number(u.id) === usrFilter)}>${nameOf(u)}`)}</select>`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Subscriptions`}</div>
    ${all.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr>
          <th>${t`Customer`}
          <th>${t`What`}
          <th>${t`Price`}
          <th>${t`Per`}
          <th>${t`Renews`}
          <th>${t`Ends`}
          <th>
        <tbody>${all.map((s) => html.async`<tr>
          <td>${rowLink(node, "cms.backend.superuser.fin.party", "usr", s.usr_id, names.get(Number(s.usr_id)))}
          <td><a href="${backend.toUrl(pageUrl, { subscription: s.id })}">${s.label}</a>
            ${s.detail ? html`<small>${s.detail}</small>` : ""}
          <td style="text-align:end">${money(s.amount, s.currencyCode)}
          <td>${every(app, s.unit, s.count)}
          <td>${ended(s) ? badge(t`ended`) : s.next}
          <td>${date(s.end_date)}
          <td>${s.end_date ? "" : html.async`<button data-action=cancel data-id="${s.id}"
              u2-confirm="${t`End it with the period under way?`}">${t`Cancel subscription`}</button>`}
            ${s.billed ? "" : html.async`<button data-action=remove data-id="${s.id}"
              u2-confirm="${t`Delete it? It was never billed.`}">${t`Delete`}</button>`}`)}
      </table></div>` : html.async`<p>${t`No subscriptions yet`}`}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Next billing run`} <small>${t`until`} ${until}</small></div>
    ${due.length ? html.async`<table class=u2-table style="white-space:nowrap">${due.map((s) => html`<tr>
      <td>${names.get(Number(s.usr_id))}
      <td>${s.label} ${s.detail}
      <td>${s.next}`)}</table>
      <button data-action=bill>${t`Bill now`}</button>` : html.async`<p>${t`Nothing to bill`}`}
    <p><small>${t`One invoice per customer, as a draft to look at — or issued, as the settings say.`}</small>
    <settings-editor source="/api/core/settings/fin.subscription"></settings-editor>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`New subscription`}</div>
    <form data-subscribe>
      <u2-fields>
        ${t`Customer`} ${userSelect("usrId")}
        ${t`Plan`} <select name=planId><option value="">—${catalog.map((p) =>
          html`<option value="${p.id}">${p.name}`)}</select>
        ${t`What`} <input name=name placeholder="${t`with a plan: the detail, e.g. example.ch`}">
        ${t`Description`} <textarea name=description rows=2 placeholder="${t`empty: the plan's`}"></textarea>
        ${terms(app, {}, catalog)}
        ${t`From`} <input name=start type=date value="${today()}" required>
      </u2-fields>
      <button>${t`Add`}</button>
    </form>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Plans`}</div>
    ${catalog.length ? html.async`<table class=u2-table style="white-space:nowrap">${catalog.map((p) => html.async`<tr>
      <td><a href="${backend.toUrl(pageUrl, { plan: p.id })}">${p.name}</a>
      <td style="text-align:end">${money(p.price, p.currency)}
      <td>${every(app, p.interval_unit, p.interval_count)}
      <td>${all.filter((s) => Number(s.plan_id) === Number(p.id)).length}×`)}</table>` : ""}
    <form data-plan>
      <u2-fields>
        ${t`Name`} <input name=name required placeholder="Hosting Light">
        ${t`Description`} <textarea name=description rows=3></textarea>
        ${terms(app, { currency: await mainCurrency(app), interval_unit: "year", interval_count: 1 }, [])}
      </u2-fields>
      <button>${t`Add plan`}</button>
    </form>
  </div>
</div>`;
}

/** One plan: its terms, which apply to every subscription of it that does not set its own. */
async function planDetail(node: Node, id: number): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const pageUrl = await (await node.page()).url();
  const p = (await plans(app)).find((row) => Number(row.id) === id);
  if (!p) return html.async`<div class=u2-card><div>${t`No plan`} ${id}</div></div>`;
  const used = (await subscriptions(app)).filter((s) => Number(s.plan_id) === id).length;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Subscriptions`}</a> › ${p.name}</div>
    <form data-plan="${id}">
      <u2-fields>
        ${t`Name`} <input name=name value="${p.name}" required>
        ${t`Description`} <textarea name=description rows=4>${p.description}</textarea>
        ${terms(app, p, [])}
      </u2-fields>
      <button>${t`Save`}</button>
      ${used ? "" : html.async`<button type=button data-action=removePlan data-id="${id}"
        u2-confirm="${t`Delete this plan?`}">${t`Delete`}</button>`}
    </form>
    <p><small>${used} ${t`subscriptions; a change applies to them from their next period.`}</small>
  </div>
</div>`;
}

/** One subscription: what may change — the start only while nothing was billed — and the periods
 *  billed, with their invoices. Empty fields take the plan's. */
async function detail(node: Node, id: number): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const pageUrl = await (await node.page()).url();
  const [s] = (await subscriptions(app)).filter((row) => Number(row.id) === id);
  if (!s) return html.async`<div class=u2-card><div>${t`No subscription`} ${id}</div></div>`;
  const [billed, catalog] = await Promise.all([periods(app, id), plans(app)]);
  const locked = billed.length ? html.raw(" disabled") : "";
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Subscriptions`}</a> › ${s.label} ${s.detail}</div>
    <form data-update="${id}">
      <u2-fields>
        ${t`Plan`} <select name=planId><option value="">—${catalog.map((p) =>
          html`<option value="${p.id}"${selected(Number(p.id) === Number(s.plan_id))}>${p.name}`)}</select>
        ${t`What`} <input name=name value="${s.name}" placeholder="${t`with a plan: the detail, e.g. example.ch`}">
        ${t`Description`} <textarea name=description rows=3 placeholder="${s.plan?.description ?? ""}">${
          s.description}</textarea>
        ${terms(app, s, catalog, s.plan ?? {})}
        ${t`From`} <input name=start type=date value="${date(s.start_date)}"${locked}>
        ${t`Until`} <input name=end type=date value="${date(s.end_date)}">
      </u2-fields>
      <button>${t`Save`}</button>
    </form>
    <p><small>${t`Changes apply from the next period. Empty fields take the plan's; empty until: it runs on.`}
      ${billed.length ? t`The start stays: periods are billed already.` : ""}</small>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Billed`} <small>${t`next`} ${s.next}</small></div>
    ${billed.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table style="white-space:nowrap">${billed.map((p) => html.async`<tr>
        <td>${date(p.period_start)} – ${date(p.period_end)}
        <td>${rowLink(node, "cms.backend.superuser.fin.invoice", "invoice", p.invoice_id)}`)}
      </table></div>` : html.async`<p>${t`Nothing billed yet`}`}
  </div>
</div>`;
}
