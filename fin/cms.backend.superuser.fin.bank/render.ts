import { getCtx, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, linked, money, rowLink } from "@qino/qino/cms.backend.superuser.fin";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 100;

/** The accounts, a statement upload, and the lines — unassigned ones with what they might be. */
export async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const url = getCtx().req.url.toURL();
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const accounts = await app.db.query`
    SELECT a.id, a.name, a.number, a.currency, a.created,
      COUNT(x.id) AS line_count, COALESCE(SUM(x.amount), 0) AS amount,
      SUM(CASE WHEN x.id IS NOT NULL AND x.payment_id IS NULL THEN 1 ELSE 0 END) AS unassigned
    FROM bank_account a LEFT JOIN bank_tx x ON x.account_id = a.id
    GROUP BY a.id, a.name, a.number, a.currency, a.created ORDER BY a.name`;
  const option = (value: string, label: string | Promise<string>, key: string) =>
    html.async`<option value="${value}"${value === q(key) ? html.raw(" selected") : ""}>${label}`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Accounts`}</div>
    ${accounts.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`Account`}
        <th>${t`Lines`}
        <th>${t`Unassigned`}
        <th>${t`Sum of the lines`}
      <tbody>${accounts.map((a) => html.async`<tr>
        <td>${a.name === a.number ? "" : html`${a.name}<br>`}<code>${a.number}</code>
        <td style="text-align:end">${Number(a.line_count)}
        <td style="text-align:end">${Number(a.unassigned) ? badge(a.unassigned, "--orange") : "0"}
        <td style="text-align:end; white-space:nowrap">${money(a.amount, a.currency)}`)}
    </table>` : html.async`<p>${t`No account yet — it is created by its first statement.`}`}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Read a statement`}</div>
    ${linked(app, "fin.bank.camt")
      ? html.async`<form data-camt>
        <input type=file name=file accept=".xml,application/xml,text/xml" required multiple>
        <button>${t`Read`}</button>
        <p><small>${t`ISO 20022 camt.053 or camt.054. Lines read before are skipped.`}</small>
      </form>`
      : html.async`<p>${t`Link fin.bank.camt to read camt files.`}`}
  </div>
  <div class=u2-card style="flex:1 1 100%">
    <div class=-head>${t`Lines`}</div>
    <form method=get>
      <input type=search name=search value="${q("search")}" placeholder="${t`Party, reference, text, id`}">
      <select name=account>
        ${option("", t`All accounts`, "account")}${accounts.map((a) => option(String(a.id), String(a.name), "account"))}
      </select>
      <select name=state>
        ${option("", t`All`, "state")}
        ${option("open", t`Unassigned`, "state")}
        ${option("assigned", t`Assigned`, "state")}
      </select>
      <button>${t`Filter`}</button>
    </form>
    <div style="overflow:auto; max-height:70vh; padding:0">${lines(node, url)}</div>
  </div>
</div>`;
}

/** One page of lines, newest first; an unassigned one with a form to say what it is. */
async function lines(node: Node, url: URL) {
  const app = node.app;
  const t = app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const sh = sqlSearch(q("search") || q("line"), ["party_name", "reference", "text"], { exact: ["id"] });
  const where = [
    sh.where,
    q("account") ? sql`account_id = ${Number(q("account"))}` : null,
    q("state") === "open" ? sql`payment_id IS NULL` : q("state") === "assigned" ? sql`payment_id IS NOT NULL` : null,
  ].flatMap((term) => term ?? []);
  const page = Math.max(0, Number(q("page")) || 0);
  const [rows, total] = await Promise.all([
    app.db.query`SELECT * FROM bank_tx WHERE ${sql.join(where, " AND ")}
      ORDER BY date DESC, id DESC LIMIT ${PER_PAGE} OFFSET ${page * PER_PAGE}`,
    app.db.one`SELECT COUNT(*) FROM bank_tx WHERE ${sql.join(where, " AND ")}`.then(Number),
  ]);
  if (!rows.length) return html.async`<p>${t`No lines`}`;
  const guesses = await suggestions(app, rows.filter((row) => !row.payment_id));
  const pageUrl = await (await node.page()).url();
  const at = (p: number) => backend.toUrl(pageUrl, { ...Object.fromEntries(url.searchParams), page: p });
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Id`}
      <th>${t`Date`}
      <th>${t`Amount`}
      <th>${t`Party`}
      <th>${t`Reference`}
      <th>${t`Text`}
      <th>${t`Payment`}
    <tbody>${rows.map((row) => html.async`<tr>
      <td>${row.id}
      <td style="white-space:nowrap">${row.date}
      <td style="text-align:end; white-space:nowrap">${money(row.amount, row.currency)}
      <td>${row.party_name}${row.party_account ? html`<br><small>${row.party_account}</small>` : ""}
      <td>${row.reference ? html`<code style="white-space:nowrap">${readable(String(row.reference))}</code>` : ""}
      <td style="white-space:pre-line">${row.text}
      <td>${row.payment_id
        ? rowLink(node, "cms.backend.superuser.fin.payment", "payment", row.payment_id)
        : assignForm(app, row, guesses.get(Number(row.id)) ?? [])}`)}
    ${total > PER_PAGE ? html`<tfoot><tr><td colspan=7>
      ${page ? html`<a href="${at(page - 1)}">‹</a>` : ""}
      ${page * PER_PAGE + 1}–${page * PER_PAGE + rows.length} / ${total}
      ${(page + 1) * PER_PAGE < total ? html`<a href="${at(page + 1)}">›</a>` : ""}` : ""}
  </table>`;
}

/** A reference as people read it: a QR reference as `21 00000 00003 …`, a creditor reference in
 *  fours, anything else as it is. */
const readable = (ref: string) =>
  /^\d{27}$/.test(ref) ? `${ref.slice(0, 2)} ${ref.slice(2).replace(/(\d{5})(?=\d)/g, "$1 ")}`
    : /^RF/.test(ref) ? ref.replace(/(.{4})(?=.)/g, "$1 ")
    : ref;

/** What a line could be for: a ref typed in, or an open invoice of the same amount and direction. */
function assignForm(app: App, row: Row, guesses: { ref: string; label: string }[]) {
  return html.async`<form data-assign="${row.id}">
    <input name=ref required size=16 placeholder="fin.invoice:7" list="guesses-${row.id}"
      value="${guesses.length === 1 ? guesses[0].ref : ""}">
    <datalist id="guesses-${row.id}">${guesses.map((g) => html`<option value="${g.ref}">${g.label}`)}</datalist>
    <button>${app.t`Assign`}</button>
  </form>`;
}

/** Open invoices whose rest is exactly a line's amount — money in for issued ones, out for received
 *  ones; a credit note's rest is negative, so it goes out by itself. */
async function suggestions(app: App, open: Row[]) {
  const found = new Map<number, { ref: string; label: string }[]>();
  if (!open.length || !linked(app, "fin.invoice")) return found;
  const invoices = await app.db.query`
    SELECT id, direction, number, currency, total - paid AS rest, party FROM invoice WHERE status = 'open'`;
  for (const row of open) {
    const amount = Number(row.amount);
    found.set(Number(row.id), invoices
      // what the line would be: our claim comes in, theirs goes out
      .filter((i) => i.currency === row.currency && (i.direction === "out" ? 1 : -1) * Number(i.rest) === amount)
      .map((i) => ({
        ref: `fin.invoice:${i.id}`,
        label: `${i.number ?? "#" + i.id} ${JSON.parse(String(i.party ?? "{}"))?.name ?? ""}`.trim(),
      })));
  }
  return found;
}
