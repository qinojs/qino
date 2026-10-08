import { getCtx, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import {
  amounts, badge, direction, money, refLink, rowLink, status,
} from "@qino/qino/cms.backend.superuser.fin";
import { nameOf } from "@qino/qino/fin";
import * as u2 from "@qino/qino/u2";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const id = Number(url.searchParams.get("usr"));
  return Number.isSafeInteger(id) && id > 0 ? detail(node, id) : overview(node, url);
}

/**
 * The users invoices are for or from. Who is a customer and who a supplier follows from the
 * invoices: issued to them, received from them — or both.
 */
async function overview(node: Node, url: URL) {
  const app = node.app;
  const t = app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const pageUrl = await (await node.page()).url();
  const { where } = sqlSearch(q("search"), ["u.given_name", "u.family_name", "u.organization", "u.address_locality"], {
    exact: ["u.id"],
  });
  const role = q("role");
  const having = role === "customer"
    ? sql`HAVING SUM(CASE WHEN i.direction = 'out' THEN 1 ELSE 0 END) > 0`
    : role === "supplier"
    ? sql`HAVING SUM(CASE WHEN i.direction = 'in' THEN 1 ELSE 0 END) > 0`
    : sql``;
  const rows = await app.db.query`
    SELECT u.id, u.given_name, u.family_name, u.organization, u.address_locality,
      SUM(CASE WHEN i.direction = 'out' THEN 1 ELSE 0 END) AS issued,
      SUM(CASE WHEN i.direction = 'in' THEN 1 ELSE 0 END) AS received
    FROM usr u JOIN invoice i ON i.usr_id = u.id
    WHERE ${where}
    GROUP BY u.id, u.given_name, u.family_name, u.organization, u.address_locality ${having}
    ORDER BY u.family_name, u.given_name LIMIT 200`;
  const ids = rows.map((row) => Number(row.id));
  // what is open, per user, direction and currency: what they owe us and what we owe them
  const open = ids.length
    ? await app.db.query`SELECT usr_id, direction, currency,
        SUM(total - paid) AS amount FROM invoice
      WHERE status = 'open' AND ${sql.in("usr_id", ids)} GROUP BY usr_id, direction, currency ORDER BY currency`
    : [];
  // what users hold as credit, where credit is kept
  const credits = ids.length && app.modules.linked("fin.payment.credit")
    ? await app.db.query`SELECT usr_id, currency, SUM(amount) AS amount FROM payment_credit
      WHERE ${sql.in("usr_id", ids)} GROUP BY usr_id, currency HAVING SUM(amount) <> 0 ORDER BY currency`
    : undefined;
  const owed = (id: unknown, dir: string) =>
    amounts(open.filter((o) => Number(o.usr_id) === Number(id) && o.direction === dir));
  const option = (value: string, label: string | Promise<string>) =>
    html.async`<option value="${value}"${value === role ? html.raw(" selected") : ""}>${label}`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Customers & suppliers`}</div>
    <form>
      <input type=search name=search value="${q("search")}" placeholder="${t`Name, place, id`}">
      <select name=role>${option("", t`All`)}${option("customer", t`Customers`)}${
    option("supplier", t`Suppliers`)}</select>
      <button>${t`Filter`}</button>
    </form>
    ${rows.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table style="white-space:nowrap">
      <thead><tr>
        <th>${t`Name`}
        <th>${t`Place`}
        <th>${t`Role`}
        <th>${t`Invoices`}
        <th>${t`Receivable`}
        <th>${t`Payable`}
        ${credits ? html.async`<th>${t`Credit`}` : ""}
      <tbody>${rows.map((row) => html.async`<tr u2-href>
        <td><a href="${backend.toUrl(pageUrl, { usr: row.id })}">${nameOf(row)}</a> <small>#${row.id}</small>
        <td>${row.address_locality}
        <td>${Number(row.issued) ? badge(t`customer`, "--blue") : ""} ${
      Number(row.received) ? badge(t`supplier`, "--orange") : ""}
        <td style="text-align:end">${Number(row.issued) + Number(row.received)}
        <td style="text-align:end">${owed(row.id, "out")}
        <td style="text-align:end">${owed(row.id, "in")}
        ${credits ? html.async`<td style="text-align:end">${
      amounts(credits.filter((c) => Number(c.usr_id) === Number(row.id)))}` : ""}`)}
    </table></div>` : html.async`<p>${t`No one with invoices yet`}`}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`New supplier or customer`}</div>
    <form data-create>
      <u2-fields>
        ${t`Organization`} <input name=organization>
        ${t`Given name`} <input name=given_name>
        ${t`Family name`} <input name=family_name>
      </u2-fields>
      <button>${t`Create`}</button>
    </form>
    <p><small>${t`Created as a user without a login; the address follows on its page.`}</small>
  </div>
</div>`;
}

/** One party: its name and postal address, kept here, and its invoices. */
async function detail(node: Node, id: number): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const pageUrl = await (await node.page()).url();
  const u = await app.db.row`SELECT * FROM usr WHERE id = ${id}`;
  if (!u) return html.async`<div class=u2-card><div>${t`No user`} ${id}</div></div>`;
  const invoices = await app.db.query`SELECT * FROM invoice WHERE usr_id = ${id} ORDER BY id DESC LIMIT 100`;
  const input = (label: string | Promise<string>, name: string, attrs = "") =>
    html.async`${label} <input name=${name} value="${u[name]}"${html.raw(attrs)}>`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head><a href="${pageUrl}">${t`Customers & suppliers`}</a> › ${nameOf(u)} <small>#${id}</small></div>
    <form data-save="${id}">
      <u2-fields>
        ${input(t`Organization`, "organization")}
        ${input(t`Given name`, "given_name")}
        ${input(t`Family name`, "family_name")}
        ${input(t`Street`, "street_address")}
        ${input(t`Postal code`, "postal_code", " size=8")}
        ${input(t`Place`, "address_locality")}
        ${input(t`Region`, "address_region")}
        ${input(t`Country`, "address_country", " maxlength=2 size=3 placeholder=CH")}
        ${input(t`IBAN`, "iban", " size=30")}
      </u2-fields>
      <button>${t`Save`}</button>
    </form>
    <p><small>${t`New invoices take this address; issued ones keep the one they were issued with.`}</small>
  </div>
  ${app.modules.linked("fin.payment.credit") ? credit(node, id) : ""}
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Invoices`}</div>
    ${invoices.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table style="white-space:nowrap">
      ${invoices.map((row) => html.async`<tr>
        <td>${rowLink(node, "cms.backend.superuser.fin.invoice", "invoice", row.id, String(row.number || `#${row.id}`))}
        <td>${direction(row.direction, row.direction === "out" ? t`issued` : t`received`)}
        <td>${row.date}
        <td style="text-align:end">${money(row.total, row.currency)}
        <td>${status(row.status)}`)}
    </table></div>` : html.async`<p>${t`No invoices yet`}`}
  </div>
</div>`;
}

/** A party's credit: the balance per currency, what moved, and adding to it by hand. */
async function credit(node: Node, id: number): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const { moves } = await import("@qino/qino/fin.payment.credit");
  const rows = await moves(app, id);
  const balances = await app.db.query`SELECT currency, SUM(amount) AS amount FROM payment_credit
    WHERE usr_id = ${id} GROUP BY currency ORDER BY currency`;
  return html.async`<div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Credit`} ${amounts(balances)}</div>
    ${rows.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table style="white-space:nowrap">${rows.map((m) => html.async`<tr>
        <td>${u2.el.time(m.created, { narrow: true })}
        <td style="text-align:end">${money(m.amount, m.currency)}
        <td>${m.text}
        <td>${refLink(node, m.ref)}`)}
      </table></div>` : ""}
    <form data-credit="${id}">
      <input name=amount inputmode=decimal size=8 placeholder="${t`Amount`}" required>
      <input name=currency value=CHF maxlength=3 size=4 required>
      <input name=text placeholder="${t`Why`}">
      <button>${t`Add credit`}</button>
    </form>
  </div>`;
}
