import { getCtx, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, money, refLink } from "@qino/qino/cms.backend.superuser.fin";
import { balances } from "@qino/qino/fin.accounting";
import * as u2 from "@qino/qino/u2";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 100;
const total = (rows: Row[]) => rows.reduce((sum, row) => sum + Number(row.amount), 0);
/** Rows of the form for an entry by hand. */
const LINES = 4;
/** Debit types show debit as positive; the others are credit by nature and show credit so. */
const DEBIT = new Set(["asset", "expense"]);
const TYPES = ["asset", "liability", "equity", "income", "expense"];

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const id = Number(url.searchParams.get("entry"));
  return Number.isSafeInteger(id) && id > 0 ? detail(node, id) : overview(node, url);
}

/** Balance sheet and result of a period, the journal, an entry by hand, the chart. */
async function overview(node: Node, url: URL) {
  const app = node.app;
  const t = app.t;
  const year = new Date().getFullYear();
  const from = url.searchParams.get("from") || `${year}-01-01`;
  const to = url.searchParams.get("to") || `${year}-12-31`;
  const currency = String(await app.settings["fin.accounting"].currency ?? "");
  const accounts = await balances(app, { from, to });
  const selected = (number: unknown) => url.searchParams.get("account") === number ? html.raw(" selected") : "";
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 100%">
    <div class=-head>${t`Period`}</div>
    <form method=get>
      <input type=date name=from value="${from}"> – <input type=date name=to value="${to}">
      <button>${t`Show`}</button>
      ${currency ? "" : html.async` ${badge(t`No book currency: nothing is booked.`, "--orange")}`}
    </form>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Balance sheet`} <small>${t`at`} ${to}</small></div>
    ${statement(app, accounts, ["asset"], ["liability", "equity"], currency)}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Result`} <small>${from} – ${to}</small></div>
    ${statement(app, accounts, ["expense"], ["income"], currency)}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Journal`}</div>
    <form method=get>
      <input type=hidden name=from value="${from}"><input type=hidden name=to value="${to}">
      <input type=search name=search value="${url.searchParams.get("search") ?? ""}" placeholder="${t`Text, ref, id`}">
      <select name=account>
        <option value="">${t`All accounts`}
        ${accounts.map((a) => html`<option value="${a.number}"${selected(a.number)}>${a.number} ${a.name}`)}
      </select>
      <button>${t`Filter`}</button>
    </form>
    <div style="overflow:auto; padding:0">${journal(node, url, from, to)}</div>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Book by hand`}</div>
    ${entryForm(app, accounts)}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Chart of accounts`}</div>
    <div style="overflow:auto; max-height:30rem; padding:0"><table class=u2-table>
      ${accounts.map((a) => html`<tr><td>${a.number}<td>${a.name}<td><small>${a.type}</small>`)}
    </table></div>
    <form data-account>
      <input name=number required size=6 placeholder="6510">
      <input name=name required placeholder="${t`Name`}">
      <select name=type>${TYPES.map((type) => html`<option>${type}`)}</select>
      <button>${t`Add`}</button>
    </form>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Settings`}</div>
    <settings-editor source="/api/core/settings/fin.accounting"></settings-editor>
  </div>
</div>`;
}

/** Two sides with their accounts and totals; the difference is the profit or what equity makes up. */
function statement(app: App, rows: Row[], left: string[], right: string[], currency: string) {
  const t = app.t;
  const shown = (row: Row) => (DEBIT.has(String(row.type)) ? 1 : -1) * Number(row.balance);
  const side = (types: string[]) => rows.filter((row) => types.includes(String(row.type)) && Number(row.balance));
  const sum = (list: Row[]) => list.reduce((s, row) => s + shown(row), 0);
  const [l, r] = [side(left), side(right)];
  const table = (list: Row[]) => html`<table class=u2-table>${list.map((row) => html`<tr>
    <td>${row.number} ${row.name}<td style="text-align:end; white-space:nowrap">${money(shown(row), currency)}`)}
    <tr><th>Σ<th style="text-align:end; white-space:nowrap">${money(sum(list), currency)}</table>`;
  const difference = sum(r) - sum(l);
  return html.async`<div class=u2-flex style="padding:0">
    <div style="flex:1 1 14rem">${table(l)}</div>
    <div style="flex:1 1 14rem">${table(r)}</div>
  </div>
  <p>${left[0] === "expense"
    ? html.async`${difference >= 0 ? t`Profit` : t`Loss`}: <b>${money(Math.abs(difference), currency)}</b>`
    : html.async`${t`Result not yet booked to equity`}: <b>${money(-difference, currency)}</b>`}`;
}

/** One page of entries, newest first, with their lines in short. */
async function journal(node: Node, url: URL, from: string, to: string) {
  const app = node.app;
  const t = app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const sh = sqlSearch(q("search"), ["e.text", "e.ref"], { exact: ["e.id"] });
  const where = [
    sh.where,
    sql`e.date >= ${from} AND e.date <= ${to}`,
    q("account") ? sql`EXISTS (SELECT 1 FROM accounting_entry_line x JOIN accounting_account y ON y.id = x.account_id
      WHERE x.entry_id = e.id AND y.number = ${q("account")})` : null,
  ].flatMap((term) => term ?? []);
  const page = Math.max(0, Number(q("page")) || 0);
  const entries = await app.db.query`SELECT e.* FROM accounting_entry e WHERE ${sql.join(where, " AND ")}
    ORDER BY e.date DESC, e.id DESC LIMIT ${PER_PAGE + 1} OFFSET ${page * PER_PAGE}`;
  if (!entries.length) return html.async`<p>${t`No entries`}`;
  const more = entries.length > PER_PAGE;
  const shown = entries.slice(0, PER_PAGE);
  const lines = await app.db.query`
    SELECT l.entry_id, l.amount, a.number FROM accounting_entry_line l JOIN accounting_account a ON a.id = l.account_id
    WHERE ${sql.in("l.entry_id", shown.map((e) => Number(e.id)))} ORDER BY l.amount DESC`;
  const pageUrl = await (await node.page()).url();
  const at = (p: number) => backend.toUrl(pageUrl, { ...Object.fromEntries(url.searchParams), page: p });
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Id`}
      <th>${t`Date`}
      <th>${t`Text`}
      <th>${t`Debit`}
      <th>${t`Credit`}
      <th>${t`Amount`}
      <th>${t`For`}
    <tbody>${shown.map((entry) => {
      const own = lines.filter((l) => Number(l.entry_id) === Number(entry.id));
      const debit = own.filter((l) => Number(l.amount) > 0);
      return html.async`<tr u2-href>
        <td><a href="${backend.toUrl(pageUrl, { entry: entry.id })}">${entry.id}</a>
        <td style="white-space:nowrap">${entry.date}
        <td>${entry.text}${entry.reverses ? html` <small>↩ ${entry.reverses}</small>` : ""}
        <td>${debit.map((l) => l.number).join(", ")}
        <td>${own.filter((l) => Number(l.amount) < 0).map((l) => l.number).join(", ")}
        <td style="text-align:end; white-space:nowrap">${money(total(debit), entry.currency)}
        <td>${refLink(node, entry.ref)}`;
    })}
    ${page || more ? html`<tfoot><tr><td colspan=7>
      ${page ? html`<a href="${at(page - 1)}">‹</a>` : ""} ${page + 1}
      ${more ? html`<a href="${at(page + 1)}">›</a>` : ""}` : ""}
  </table>`;
}

/** An entry by hand: a few lines, each debit or credit, as people write amounts. */
function entryForm(app: App, accounts: Row[]) {
  const t = app.t;
  const options = html.join(accounts.map((a) => html`<option value="${a.number}">${a.number} ${a.name}`));
  return html.async`<form data-book>
    <u2-fields>
      ${t`Date`} <input type=date name=date required value="${new Date().toLocaleDateString("sv-SE")}">
      ${t`Text`} <input name=text required>
    </u2-fields>
    <div style="overflow:auto"><table class=u2-table>
      <thead><tr><th>${t`Account`}<th>${t`Debit`}<th>${t`Credit`}
      <tbody>${Array.from({ length: LINES }, (_, i) => html`<tr>
        <td><select name="account${i}"><option value="">${options}</select>
        <td><input name="debit${i}" inputmode=decimal size=8>
        <td><input name="credit${i}" inputmode=decimal size=8>`)}
    </table></div>
    <button>${t`Book`}</button>
  </form>`;
}

/** One entry: its lines debit and credit, its receipts, what reverses it. */
async function detail(node: Node, id: number) {
  const app = node.app;
  const t = app.t;
  const entry = await app.db.row`SELECT * FROM accounting_entry WHERE id = ${id}`;
  const pageUrl = await (await node.page()).url();
  if (!entry) return html.async`<div class=u2-card><div>${t`No entry`} ${id}</div></div>`;
  const [lines, files, reversal] = await Promise.all([
    app.db.query`SELECT l.*, a.number, a.name FROM accounting_entry_line l
      JOIN accounting_account a ON a.id = l.account_id
      WHERE l.entry_id = ${id} ORDER BY l.amount DESC, a.number`,
    app.db.col`SELECT file_id FROM accounting_entry_file WHERE entry_id = ${id}`,
    app.db.one`SELECT id FROM accounting_entry WHERE reverses = ${id}`,
  ]);
  const links = await Promise.all(files.map(async (fileId) => {
    const file = await app.dbFiles.file(Number(fileId));
    return html`<a href="${await file.url({ grant: "session" })}" target=_blank>${file.name}</a>`;
  }));
  const link = (other: unknown) => html`<a href="${backend.toUrl(pageUrl, { entry: other })}">#${other}</a>`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Journal`}</a> › #${id}</div>
    <table class=u2-table>
      <tr><th>${t`Date`}<td>${entry.date}
      <tr><th>${t`Text`}<td>${entry.text}
      <tr><th>${t`For`}<td>${refLink(node, entry.ref)}
      <tr><th>${t`Booked`}<td>${u2.el.time(entry.created)}
        · ${entry.usr_id ? html.async`${t`user`} ${entry.usr_id}` : t`automatic`}
      ${entry.reverses ? html.async`<tr><th>${t`Reverses`}<td>${link(entry.reverses)}` : ""}
      ${reversal ? html.async`<tr><th>${t`Reversed by`}<td>${link(reversal)}` : ""}
      ${links.length ? html.async`<tr><th>${t`Receipts`}<td>${html.join(links, ", ")}` : ""}
    </table>
    <div style="overflow:auto"><table class=u2-table>
      <thead><tr><th>${t`Account`}<th>${t`Debit`}<th>${t`Credit`}<th>${t`Tax code`}
      <tbody>${lines.map((l) => html`<tr>
        <td>${l.number} ${l.name}
        <td style="text-align:end">${Number(l.amount) > 0 ? money(l.amount, entry.currency) : ""}
        <td style="text-align:end">${Number(l.amount) < 0 ? money(-Number(l.amount), entry.currency) : ""}
        <td>${l.tax_code}`)}
    </table>
    ${reversal || entry.reverses ? "" : html.async`<div>
      <button data-reverse="${id}" u2-confirm="${t`Take this entry back with a reversal?`}">${t`Reverse`}</button>
    </div>`}
  </div>
</div>`;
}
