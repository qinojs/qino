import { getCtx, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, direction, money, pager, refLink, rowLink, status } from "@qino/qino/cms.backend.superuser.fin";
import { mainCurrency } from "@qino/qino/fin";
import { methods, provider as providerOf, slip } from "@qino/qino/fin.payment";
import * as u2 from "@qino/qino/u2";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Provider } from "@qino/qino/fin.payment";

const STATUSES = ["pending", "processing", "paid", "failed", "canceled", "expired", "refunded"];
const PER_PAGE = 100;

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const id = Number(url.searchParams.get("payment"));
  return Number.isSafeInteger(id) && id > 0 ? detail(node, id) : overview(node, url);
}

/** The journal of payments with its filters, the providers, and a form for what happened by hand. */
async function overview(node: Node, url: URL) {
  const t = node.app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const providers = await node.app.db.col<string>`SELECT DISTINCT provider FROM payment ORDER BY provider`;
  const option = (value: string, label: string | Promise<string>, key = "") =>
    html.async`<option value="${value}"${value === q(key) ? html.raw(" selected") : ""}>${label}`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Payments`}</div>
    <form method=get>
      <input type=search name=search value="${q("search")}" placeholder="${t`Id, ref, description, external id`}">
      <select name=direction>
        ${option("", t`In and out`, "direction")}
        ${option("in", t`In`, "direction")}
        ${option("out", t`Out`, "direction")}
      </select>
      <select name=status>${option("", t`Any status`, "status")}${STATUSES.map((s) => option(s, s, "status"))}</select>
      <select name=provider>
        ${option("", t`Any provider`, "provider")}${providers.map((p) => option(p, p, "provider"))}
      </select>
      <button>${t`Filter`}</button>
    </form>
    <div style="overflow:auto; max-height:70vh; padding:0">${list(node, url)}</div>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Providers`}</div>
    ${providerTable(node.app)}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Record a payment`}</div>
    <form data-record>
      <u2-fields>
        ${t`Direction`} <select name=direction>${option("in", t`In`)}${option("out", t`Out`)}</select>
        ${t`Source`} <input name=provider required placeholder="cash, bank …">
        ${t`Amount`} <input name=amount required inputmode=decimal placeholder="120.00">
        ${t`Currency`} <input name=currency required value="${mainCurrency(node.app)}" maxlength=3 size=4>
        ${t`For (ref)`} <input name=ref placeholder="fin.invoice:7">
        ${t`Description`} <input name=description>
      </u2-fields>
      <button>${t`Record`}</button>
    </form>
  </div>
</div>`;
}

/** One page of payments, newest first, filtered by the URL. */
async function list(node: Node, url: URL) {
  const app = node.app;
  const t = app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const sh = sqlSearch(q("search"), ["ref", "description", "external_id"], { exact: ["id"] });
  const where = [
    sh.where,
    q("direction") ? sql`direction = ${q("direction")}` : null,
    q("status") ? sql`status = ${q("status")}` : null,
    q("provider") ? sql`provider = ${q("provider")}` : null,
  ].flatMap((term) => term ?? []);
  const page = Math.max(0, Number(q("page")) || 0);
  const [rows, total] = await Promise.all([
    app.db.query`SELECT * FROM payment WHERE ${sql.join(where, " AND ")}
      ORDER BY id DESC LIMIT ${PER_PAGE} OFFSET ${page * PER_PAGE}`,
    app.db.one`SELECT COUNT(*) FROM payment WHERE ${sql.join(where, " AND ")}`.then(Number),
  ]);
  if (!rows.length) return html.async`<p>${t`No payments`}`;
  const pageUrl = await (await node.page()).url();
  return html.async`<table class=u2-table style="white-space:nowrap">
    <thead><tr>
      <th>${t`Id`}
      <th>${t`Created`}
      <th>
      <th>${t`Provider`}
      <th>${t`Amount`}
      <th>${t`Paid`}
      <th>${t`Status`}
      <th>${t`For`}
      <th>${t`Description`}
    <tbody>${rows.map((row) => html.async`<tr u2-href>
      <td><a href="${backend.toUrl(pageUrl, { payment: row.id })}">${row.id}</a>
      <td style="white-space:nowrap">${u2.el.time(row.created, { narrow: true })}
      <td>${direction(row.direction, row.direction === "in" ? t`in` : t`out`)}
      <td>${row.provider}${row.method ? html`<small>.${row.method}</small>` : ""}
      <td style="text-align:end; white-space:nowrap">${money(row.amount, row.currency)}
      <td style="text-align:end; white-space:nowrap">${paidOf(row)}
      <td>${status(row.status)}
      <td>${refLink(node, row.ref)}
      <td>${row.description}`)}
    ${pager(pageUrl, url, { page, shown: rows.length, total, per: PER_PAGE, span: 9 })}
  </table>`;
}

/** What moved: paid, less what went back. */
const paidOf = (row: Row) => {
  const paid = money(row.paid, row.currency);
  return Number(row.refunded) ? `${paid} − ${money(row.refunded, row.currency)}` : paid;
};

/** Every linked provider: what it offers, what it can, and its settings. */
async function providerTable(app: App) {
  const t = app.t;
  const mods = app.modules.linked().filter((mod) => mod.plugin.paymentProvider);
  if (!mods.length) return html.async`<p>${t`No provider linked: payments can only be recorded.`}`;
  // what each offers in the main currency, and in every one payments were made in
  const used = await app.db.col<string>`SELECT DISTINCT currency FROM payment ORDER BY currency`;
  const currencies = [...new Set([await mainCurrency(app), ...used].filter((c): c is string => !!c))];
  const offered = await Promise.all(currencies.map(async (currency) =>
    [currency, (await methods(app, { amount: 10000, currency })).map((m) => m.method)] as const));
  return html.async`${mods.map(async (mod) => {
    const p = mod.plugin.paymentProvider as Provider;
    const can = await Promise.all([p.refund && t`refund`, p.slip && t`slip`].filter(Boolean));
    const own = (list: readonly string[]) => list.filter((m) => m.split(".")[0] === p.name);
    const offers = offered.map(([currency, list]) => [currency, own(list)] as const).filter(([, list]) => list.length);
    return html.async`<details>
      <summary><b>${p.label}</b> <code>${p.name}</code> <small>${mod.name}</small></summary>
      <table class=u2-table>
        <tr><th>${t`Offers`}<td>${offers.length
          ? html.join(offers.map(([currency, list]) => html`${currency}: ${list.join(", ")}`), "<br>")
          : badge(t`nothing — settings incomplete?`, "--orange")}
        <tr><th>${t`Can`}<td>${can.join(", ") || "—"}
      </table>
      ${mod.plugin.settingsSchema ? settingsEditor(mod.name) : ""}
    </details>`;
  })}`;
}

const sumOf = (rows: Row[]) => rows.reduce((sum, row) => sum + Number(row.amount), 0);

const settingsEditor = (module: string) =>
  html`<settings-editor source="/api/core/settings/${module}"></settings-editor>`;

/** One payment with everything known about it, and what can be done with it. */
async function detail(node: Node, id: number) {
  const app = node.app;
  const t = app.t;
  const [row, pageUrl] = await Promise.all([
    app.db.row`SELECT * FROM payment WHERE id = ${id}`,
    node.page().then((page) => page.url()),
  ]);
  if (!row) return html.async`<div class=u2-card><div>${t`No payment`} ${id}</div></div>`;
  const provider = providerOf(app, String(row.provider));
  const open = Number(row.paid) - Number(row.refunded);
  const data = row.data ? JSON.stringify(JSON.parse(String(row.data)), null, 2) : "";
  const shown = await slip(app, id).catch((e) => badge(e.message, "--red"));
  const lines = app.modules.linked("fin.bank")
    ? await app.db.query`SELECT * FROM bank_tx WHERE payment_id = ${id} ORDER BY date, id`
    : [];
  const field = (label: string | Promise<string>, value: unknown) => html.async`<tr><th>${label}<td>${value}`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Payments`}</a> › #${id}</div>
    <table class=u2-table>
      ${field(t`Status`, status(row.status))}
      ${field(t`Direction`, html.async`${direction(row.direction, "")} ${row.direction}`)}
      ${field(t`Provider`, provider
        ? `${provider.label} (${row.provider})`
        : html.async`${row.provider} <small>${t`not linked, or recorded`}</small>`)}
      ${field(t`Method`, row.method)}
      ${field(t`Amount`, money(row.amount, row.currency))}
      ${field(t`Paid`, money(row.paid, row.currency))}
      ${field(t`Refunded`, money(row.refunded, row.currency))}
      ${field(t`Fee`, money(row.fee, row.currency))}
      ${field(t`For (ref)`, refLink(node, row.ref))}
      ${field(t`Description`, row.description)}
      ${field(t`User`, row.usr_id)}
      ${field(t`External id`, row.external_id ? html`<code>${row.external_id}</code>` : "")}
      ${field(t`Return to`, row.return_url)}
      ${field(t`Created`, u2.el.time(row.created))}
      ${field(t`Changed`, u2.el.time(row.changed))}
    </table>
    <div>
      ${provider ? html.async`<button data-sync="${id}">${t`Ask the provider`}</button>` : ""}
      ${provider?.refund && open > 0 ? html.async`<form data-refund="${id}" style="display:inline">
        <input name=amount inputmode=decimal size=8 placeholder="${money(open, row.currency)}">
        <button u2-confirm="${t`Really pay back?`}">${t`Refund`}</button>
      </form>` : ""}
    </div>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`The provider's own state`}</div>
    <pre style="overflow:auto">${data || "—"}</pre>
  </div>
  ${lines.length ? html.async`<div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Bank lines`}</div>
    <table class=u2-table>${lines.map((line) => html.async`<tr>
      <td>${rowLink(node, "cms.backend.superuser.fin.bank", "line", line.id)}
      <td>${line.date}
      <td style="text-align:end">${money(line.amount, line.currency)}
      <td>${line.party_name}`)}</table>
    <div><small>${t`Together`}: ${money(sumOf(lines), row.currency)}</small></div>
  </div>` : ""}
  ${shown ? html.async`<div class=u2-card style="flex:1 1 100%">
    <div class=-head>${t`Slip`}</div>
    <div style="overflow:auto">${html.raw(shown)}</div>
  </div>` : ""}
</div>`;
}
