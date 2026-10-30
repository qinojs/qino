import { getCtx, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import {
  badge, direction, field, inputAmount, money, option, pager, refLink, rowLink, sources, status,
} from "@qino/qino/cms.backend.fin";
import { mainCurrency, today } from "@qino/qino/fin";
import { document, lines, listedOf, owed, refOf } from "@qino/qino/fin.invoice";
import { methods } from "@qino/qino/fin.payment";
import * as u2 from "@qino/qino/u2";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const STATUSES = ["draft", "open", "paid", "uncollectible", "canceled"];
const TYPES = ["invoice", "credit_note", "proforma", "reminder"];
const PER_PAGE = 100;

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const id = Number(url.searchParams.get("invoice"));
  return Number.isSafeInteger(id) && id > 0 ? detail(node, id) : overview(node, url);
}

/** The party's name, from the snapshot. */
const partyName = (row: Row) => {
  const party = JSON.parse(String(row.party ?? "{}")) ?? {};
  return String(party.legalName || party.name || "");
};

/** A user as picked: name, then the organization. */
const userLabel = (u: Row) =>
  [[u.given_name, u.family_name].filter(Boolean).join(" "), u.organization].filter(Boolean).join(", ");

/** A user, linked to their page among customers and suppliers. */
const userLink = (node: Node, id: unknown, label = "") =>
  id ? rowLink(node, "cms.backend.fin.party", "usr", id, label || `#${id}`) : "";

/** A small link to the party's page, behind its name: the list stays about the invoices. */
async function partyIcon(node: Node, id: unknown) {
  const url = (await backend.toModuleUrl(node, "cms.backend.fin.party"))({ usr: id });
  return url ? html.async` <a href="${url}" title="${node.app.t`Customer`}"><u2-ico icon=person>👤</u2-ico></a>` : "";
}

/** A user's email address, the main one first; empty without one. */
export const emailOf = async (app: App, id: unknown) => id
  ? String(await app.db.one`SELECT address FROM usr_contact WHERE usr_id = ${Number(id)} AND type = 'email'
    ORDER BY main DESC` ?? "")
  : "";

/** The users of these rows, by id. */
async function usersOf(app: App, rows: Row[]) {
  const ids = [...new Set(rows.map((row) => Number(row.usr_id)).filter(Boolean))];
  const users = ids.length
    ? await app.db.query`SELECT id, given_name, family_name, organization FROM usr WHERE ${sql.in("id", ids)}`
    : [];
  return new Map(users.map((u) => [Number(u.id), userLabel(u)]));
}

/** Invoices with their filters, a form for a new draft, and the settings. */
async function overview(node: Node, url: URL) {
  const t = node.app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Invoices`}</div>
    <form method=get>
      <input type=search name=search value="${q("search")}" placeholder="${t`Number, party, ref`}">
      <select name=direction>
        ${option("", t`Issued and received`, q("direction"))}
        ${option("out", t`Issued (receivables)`, q("direction"))}
        ${option("in", t`Received (payables)`, q("direction"))}
      </select>
      <select name=status>${option("", t`Any status`, q("status"))}
        ${STATUSES.map((s) => option(s, s, q("status")))}</select>
      <select name=type>${option("", t`Any type`, q("type"))}
        ${TYPES.map((type) => option(type, typeName(node.app, type), q("type")))}</select>
      <label><input type=checkbox name=overdue value=1${q("overdue") ? html.raw(" checked") : ""}> ${t`overdue`}</label>
      <button>${t`Filter`}</button>
    </form>
    <div style="overflow:auto; max-height:70vh; padding:0">${list(node, url)}</div>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`New invoice`}</div>
    ${newForm(node.app)}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Settings`}</div>
    <settings-editor source="/api/core/settings/fin.invoice"></settings-editor>
  </div>
</div>`;
}

/** One page of invoices, newest first, filtered by the URL. */
async function list(node: Node, url: URL) {
  const app = node.app;
  const t = app.t;
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const sh = sqlSearch(q("search"), ["number", "ref", "party"], { exact: ["id"] });
  const where = [
    sh.where,
    q("direction") ? sql`direction = ${q("direction")}` : null,
    Number(q("usr")) ? sql`usr_id = ${Number(q("usr"))}` : null, // a party's, linked from its card
    q("status") ? sql`status = ${q("status")}` : null,
    q("type") ? sql`type = ${q("type")}` : null,
    q("overdue") ? sql`status = 'open' AND type IN ('invoice', 'reminder') AND due < ${today()}` : null,
  ].flatMap((term) => term ?? []);
  const page = Math.max(0, Number(q("page")) || 0);
  const [rows, total] = await Promise.all([
    app.db.query`SELECT * FROM invoice WHERE ${sql.join(where, " AND ")}
      ORDER BY id DESC LIMIT ${PER_PAGE} OFFSET ${page * PER_PAGE}`,
    app.db.one`SELECT COUNT(*) FROM invoice WHERE ${sql.join(where, " AND ")}`.then(Number),
  ]);
  if (!rows.length) return html.async`<p>${t`No invoices`}`;
  const pageUrl = await (await node.page()).url();
  return html.async`<table class=u2-table style="white-space:nowrap">
    <thead><tr>
      <th>#
      <th>
      <th>${t`Party`}
      <th>${t`Date`}
      <th>${t`Total`}
      <th>${t`Status`}
      <th>${t`For`}
    <tbody>${rows.map((row) => html.async`<tr u2-href>
      <td><a href="${backend.toUrl(pageUrl, { invoice: row.id })}">${row.number || html`<small>#${row.id}</small>`}</a>
        ${row.type === "invoice" ? "" : badge(typeName(app, row.type))}
      <td>${direction(row.direction, row.direction === "out" ? t`issued` : t`received`)}
      <td><span class=-party title="${partyName(row)}">${partyName(row)}</span>${row.usr_id ? partyIcon(node, row.usr_id) : ""}
      <td style="white-space:nowrap">${row.date}
      <td style="text-align:end; white-space:nowrap">${money(row.total, row.currency)}
      <td>${overdue(row)
      ? html.async`<span title="${t`Due`} ${row.due}">${badge(t`overdue`, "--red")}</span>`
      : html.async`<span title="${row.due ? html.async`${t`Due`} ${row.due}` : ""}">${status(row.status)}</span>`}
        ${partly(row) ? html.async`<small title="${t`Paid`}">${money(row.paid, row.currency)}</small>` : ""}
      <td>${refLink(node, row.ref)}`)}
    ${pager(pageUrl, url, { page, shown: rows.length, total, per: PER_PAGE, span: 7 })}
  </table>`;
}

/** What a type is called. */
const typeName = (app: App, type: unknown) =>
  type === "credit_note"
    ? app.t`credit note`
    : type === "proforma"
    ? app.t`pro forma`
    : type === "reminder"
    ? app.t`reminder`
    : app.t`invoice`;

/** Open past its due date — what claims something: an invoice, a reminder's fees. */
const overdue = (row: Row) =>
  row.status === "open" && ["invoice", "reminder"].includes(String(row.type)) && !!row.due && String(row.due) < today();

/** Open with part of it paid: the status alone would not tell. */
const partly = (row: Row) => row.status === "open" && Number(row.paid) !== 0 && Number(row.paid) !== Number(row.total);

/** The due date, marked once it has passed. */
const due = (app: App, row: Row) => overdue(row) ? html.async`${row.due} ${badge(app.t`overdue`, "--red")}` : String(row.due ?? "");

/** A new invoice: what it is, then the editor takes over. */
async function newForm(app: App) {
  const t = app.t;
  return html.async`<form data-create>
    <select name=direction>
      <option value=out>${t`Issued (receivable)`}
      <option value=proforma>${t`Pro forma invoice`}
      <option value=in>${t`Received (payable)`}
    </select>
    <input name=currency value="${mainCurrency(app)}" required maxlength=3 size=4>
    <button>${t`New invoice`}</button>
  </form>`;
}

/** Where lines may be booked, where bookkeeping is installed: the default account, and the others. */
type Accounts = { fallback: string; list: Row[] };

async function accountsOf(app: App, direction: unknown): Promise<Accounts | undefined> {
  if (!app.modules.linked("fin.accounting")) return;
  const out = direction === "out";
  const fallback = String(await app.settings["fin.accounting"].accounts[out ? "revenue" : "expense"] ?? "");
  const list = await app.db.query`SELECT number, name FROM accounting_account
    WHERE type = ${out ? "income" : "expense"} ORDER BY number`;
  return { fallback, list };
}

/** What every line of a draft shares: its currency, the default tax rate, where it may be booked. */
type Shared = { currency: unknown; rate: unknown; taxed: boolean; accounts?: Accounts };

/** The tax categories (EN 16931) by what they mean. */
const categories = (app: App): Record<string, unknown> => ({
  S: app.t`Taxed`,
  Z: app.t`Zero rated`,
  E: app.t`Excluded from tax`,
  AE: app.t`Reverse charge`,
  K: app.t`Intra-community`,
  G: app.t`Exempt: exports`,
  O: app.t`Not subject to tax`,
});

/** One editable line; `i` keeps the fields of a line together. */
const lineRow = (app: App, i: string | number, line: Row, { currency, rate, taxed, accounts }: Shared) =>
  html.async`<tr draggable=false>
  <td><button type=button class=u2-unstyle u2-draghandle title="${app.t`Reorder`}">
    <u2-ico icon=drag_indicator>⠿</u2-ico></button>
  <td class=-item><input name="name${i}" value="${line.name}">
    <textarea name="description${i}" rows=1 placeholder="${app.t`Description`}">${line.description}</textarea>
    ${accounts ? html.async`<select name="account${i}" class=-account title="${app.t`Account`}">
      <option value="">${app.t`Default account`} ${accounts.fallback}
      ${accounts.list.map((a) => html`<option value="${a.number}"${
      String(a.number) === String(line.account ?? "") ? html.raw(" selected") : ""}>${a.number} ${a.name}`)}
    </select>` : ""}
  <td><input name="quantity${i}" inputmode=decimal placeholder=1 style="width:4rem"
    value="${line.quantity == null ? "" : Number(line.quantity)}">
  <td><input name="unit${i}" style="width:3.5rem" value="${line.unit}">
  <td><input name="price${i}" inputmode=decimal style="width:6rem"
    value="${inputAmount(line.price, currency)}">
  ${taxed ? html.async`<td><input name="taxRate${i}" inputmode=decimal style="width:3.5rem" placeholder="${rate ?? 0}"
    value="${line.tax_rate == null ? "" : Number(line.tax_rate)}">
    <select name="taxCategory${i}" title="${app.t`Tax category`}">
      <option value="">${app.t`Automatic`}
      ${Object.entries(categories(app)).map(([code, label]) => html.async`<option value="${code}"${
      code === line.tax_category ? html.raw(" selected") : ""}>${code} ${label}`)}
    </select>` : ""}
  <td><button type=button data-remove-line class=u2-unstyle title="${app.t`Remove`}">
    <u2-ico icon=delete>✕</u2-ico></button>`;

/**
 * A draft: the editor beside the invoice as it will be printed. Every change is saved after a
 * moment and the preview drawn again, so what is typed is what is sent.
 */
async function editor(node: Node, row: Row) {
  const app = node.app;
  const t = app.t;
  const id = Number(row.id);
  const party = JSON.parse(String(row.party ?? "{}")) ?? {};
  const address = party.address ?? {};
  // the languages the site has texts for; the document falls back to the default one likewise
  const languages = app.languages.all;
  const term = await app.settings["fin.invoice"].term;
  // its buttons are type=button: in the form, a submit button acts on click before u2-confirm has asked
  const users = await app.db.query`SELECT id, given_name, family_name, organization FROM usr
    ORDER BY family_name, given_name`;
  const lang = languages.includes(String(row.lang)) ? String(row.lang) : app.languages.def;
  const [items, preview, pageUrl] = await Promise.all([
    lines(app, id),
    document(app, id).catch((e) => `<p>${e.message}</p>`),
    node.page().then((page) => page.url()),
  ]);
  const rate = await app.settings["fin.invoice"].taxRate;
  // a credit note is typed as what it gives back: its negative quantities shown positive
  const asGiven = (line: Row) => row.type === "credit_note" ? { ...line, quantity: -Number(line.quantity) } : line;
  const shared = {
    currency: row.currency,
    rate,
    // without a VAT ID we are not liable and show no tax: no column, unless a line has a rate; a
    // received invoice shows the tax its sender charged
    taxed: row.direction === "in" || !!(await app.settings.identity.organization.vatID || rate ||
      items.some((l) => Number(l.tax_rate))),
    accounts: await accountsOf(app, row.direction),
  };
  // side by side while there is room: the form left, the invoice it makes right
  return html.async`<div class=u2-flex style="width:100%">
  <form data-edit="${id}" class=u2-card style="flex:1 1 25rem; min-width:26rem">
    <div class=-head>
      <a href="${pageUrl}">${t`Invoices`}</a> › ${t`draft`} #${id},
      ${row.direction === "out" ? t`issued (receivable)` : t`received (payable)`} <small data-state></small>
    </div>
    <u2-fields>
      ${t`Currency`} <input name=currency value="${row.currency}" required maxlength=3 size=4>
      ${row.direction === "in" ? html.async`${t`Number`} <input name=number value="${row.number}">` : ""}
      ${t`Date`} <input type=date name=date value="${row.date}">
      ${row.direction === "in" // a received invoice says when it is due; ours say within how many days
        ? html.async`${t`Due`} <input type=date name=due value="${row.due}">`
        : html.async`${t`Payment term (days)`}
          <input type=number name=term min=0 value="${row.term}" placeholder="${term}">`}
      ${t`User`} <select name=usrId data-user><option value="">—${users.map((u) => html`<option value="${u.id}"${
        Number(u.id) === Number(row.usr_id) ? html.raw(" selected") : ""}>${userLabel(u)}`)}</select>
      ${t`Language`} <select name=lang>${languages.map((l) =>
        html`<option${l === lang ? html.raw(" selected") : ""}>${l}`)}</select>
      ${t`Name`} <input name=name value="${party.name}">
      ${t`Street`} <input name=streetAddress value="${address.streetAddress}">
      ${t`Postal code`} <input name=postalCode size=8 value="${address.postalCode}">
      ${t`Place`} <input name=addressLocality value="${address.addressLocality}">
      ${t`Country`}
      <input name=addressCountry maxlength=2 size=3 placeholder=CH value="${address.addressCountry}">
      ${t`VAT ID`} <input name=vatID value="${party.vatID}">
      ${t`Prices include tax`}
      <input type=checkbox name=taxIncluded value=1${row.tax_included ? html.raw(" checked") : ""}>
    </u2-fields>
    <div style="overflow:auto; max-height:70vh; padding:0">
      <table class=u2-table>
        <thead><tr>
          <th>
          <th>${t`Item`}
          <th>${t`Quantity`}
          <th>${t`Unit`}
          <th>${t`Unit price`}
          ${shared.taxed ? html.async`<th>${t`Tax %`}` : ""}
          <th>
        <tbody data-lines u2-dropzone>
          ${items.map((line, i) => lineRow(app, i, asGiven(line), shared))}${lineRow(app, items.length, {}, shared)}
      </table>
    </div>
    <div>
      <template data-line>${lineRow(app, "__i__", {}, shared)}</template>
      <button type=button data-add-line>${t`Add line`}</button>
      <u2-fields>${t`Notes`} <textarea name=text rows=3>${row.text}</textarea></u2-fields>
    </div>
    <div>
      <button type=button data-action=issue data-id="${id}"
        u2-confirm="${t`Issue it? Its number is drawn now; then it cannot change.`}">${t`Issue`}</button>
      <button type=button data-action=remove data-id="${id}"
        u2-confirm="${t`Throw this draft away?`}">${t`Delete draft`}</button>
    </div>
  </form>

    ${row.direction === "in" ? original(node, row) : html.async`<div class=u2-card style="flex:1 1 40%; min-width:26rem">
      <div class=-head>${t`Preview`} <button type=button data-pdf>${t`View as PDF`}</button></div>
      <iframe data-preview data-sheets srcdoc="${preview}" style="width:100%; height:85vh; border:0; padding:0"></iframe>
    </div>`}
  </div>`;
}

/** A received invoice beside its editor: the original it came as, the receipt — or where to put it. */
async function original(node: Node, row: Row) {
  const t = node.app.t;
  const file = row.file_id ? await node.app.dbFiles.file(Number(row.file_id)).catch(() => undefined) : undefined;
  const url = file ? await file.url({ grant: "session" }) : "";
  const mime = file ? String((await file.ensureVs()).mime ?? "") : "";
  const shown = !file ? ""
    : mime.startsWith("image/") ? html`<img src="${url}" alt="" style="max-width:100%">`
    : html`<iframe src="${url}" style="width:100%; height:70rem; border:0; padding:0"></iframe>`;
  return html.async`<div class=u2-card style="flex:1 1 40%; min-width:26rem">
    <div class=-head>${t`Original`} ${file ? html`<a href="${url}" target=_blank>${file.name}</a>` : ""}</div>
    ${shown}
    ${row.status === "draft" || !file ? html.async`<form data-attach="${row.id}">
      <input type=file name=file accept="application/pdf,image/*" required>
      <button>${file ? t`Replace` : t`Upload the receipt`}</button>
    </form>` : ""}
  </div>`;
}

/** One invoice: what it says, its payments, its document, and what can be done with it. */
async function detail(node: Node, id: number) {
  const app = node.app;
  const t = app.t;
  const [row, pageUrl] = await Promise.all([
    app.db.row`SELECT * FROM invoice WHERE id = ${id}`,
    node.page().then((page) => page.url()),
  ]);
  if (!row) return html.async`<div class=u2-card><div>${t`No invoice`} ${id}</div></div>`;
  if (row.status === "draft") return editor(node, row);
  const party = JSON.parse(String(row.party ?? "{}")) ?? {};
  const address = party.address ?? {};
  // a credit note asks for nothing: what is open on it, we owe, its rest being negative; anything
  // else asks for what it is owed, with what it lists
  const credit = row.type === "credit_note";
  const open = credit ? Math.abs(Number(row.total) - Number(row.paid)) : await owed(app, row);
  const claims = ["invoice", "reminder"].includes(String(row.type)) && row.direction === "out";
  const reminders = app.modules.linked("fin.invoice.reminder");
  const [items, payments, ways, listed, listing] = await Promise.all([
    lines(app, id),
    // asked for with its ref, or paid on another and shared out to it (a reminder's): each by its index
    app.db.query`SELECT p.*, a.amount AS share FROM payment p
      LEFT JOIN invoice_settlement a ON a.payment_id = p.id AND a.invoice_id = ${id}
      WHERE p.ref = ${refOf(id)}
        OR p.id IN (SELECT payment_id FROM invoice_settlement WHERE invoice_id = ${id}) ORDER BY p.id`,
    open > 0 && !credit && row.direction === "out"
      ? methods(app, { amount: open, currency: String(row.currency), usrId: Number(row.usr_id) || undefined })
      : [],
    listedOf(app, id),
    app.db.query`SELECT r.id, r.number, r.date, l.level FROM invoice_listed l JOIN invoice r ON r.id = l.invoice_id
      WHERE l.listed_id = ${id} ORDER BY r.id`,
  ]);
  // while a payment is under way it asks for the rest itself; a second would ask twice
  const waiting = payments.some((p) => p.status === "pending" || p.status === "processing");
  const file = row.file_id ? await app.dbFiles.file(Number(row.file_id)).catch(() => undefined) : undefined;
  const pdfUrl = file ? await file.url({ grant: "session" }).catch(() => "") : "";
  const preview = document(app, id).catch((e) => `<p>${e.message}</p>`);
  const users = await usersOf(app, [row]);
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>
      <a href="${pageUrl}">${t`Invoices`}</a> › ${typeName(app, row.type)} ${row.number || `#${id}`}
    </div>
    <table class=u2-table>
      ${field(t`Status`, status(row.status))}
      ${field(t`User`, userLink(node, row.usr_id, users.get(Number(row.usr_id))))}
      ${field(t`Language`, row.lang)}
      ${field(t`Type`, typeName(app, row.type))}
      ${row.preceding
        ? field(credit ? t`Corrects` : t`Follows`, rowLink(node, "cms.backend.fin.invoice", "invoice", row.preceding))
        : ""}
      ${field(t`Direction`, html.async`${direction(row.direction, "")}
        ${row.direction === "out" ? t`issued (receivable)` : t`received (payable)`}`)}
      ${field(t`Number`, row.number)}
      ${field(t`Date`, row.date)}
      ${field(t`Due`, due(app, row))}
      ${row.direction === "out" ? field(t`Sent`, html.async`<form data-sent="${id}">
        <input type=date name=date value="${row.sent}"> <button>${t`Save`}</button>
      </form>`) : ""}
      ${listing.length ? field(t`Reminded`, html.join(listing.map((r) =>
        html`<a href="${backend.toUrl(pageUrl, { invoice: r.id })}">${r.number || `#${r.id}`}</a>
          <small>${r.date}</small>`), ", ")) : ""}
      ${claims && reminders && row.status === "open" ? field(t`Reminders`, html.async`
        ${row.remind ? t`go out` : badge(t`held`, "--orange")}
        <button data-action="${row.remind ? "hold" : "release"}" data-id="${id}">
          ${row.remind ? t`Hold` : t`Release`}</button>`) : ""}
      ${field(t`Net`, money(row.net, row.currency))}
      ${field(t`Tax`, money(row.tax, row.currency))}
      ${field(t`Total`, html`<b>${money(row.total, row.currency)}</b>`)}
      ${field(t`Paid`, money(row.paid, row.currency))}
      ${field(t`Prices`, row.tax_included ? t`include tax` : t`exclude tax`)}
      ${field(t`For`, refLink(node, row.ref))}
      ${field(t`Created`, u2.el.time(row.created))}
      ${field(t`Changed`, u2.el.time(row.changed))}
    </table>
    <div>
      ${app.modules.linked("pdf") && !(row.sent && file) // what went out stays as it was
        ? html.async`<button data-action=print data-id="${id}">${t`Print PDF`}</button>`
        : ""}
      ${pdfUrl && row.direction === "out" ? html.async`<a href="${pdfUrl}" target=_blank>${t`Open PDF`}</a>` : ""}
      ${claims && reminders && row.status === "open"
        ? html.async`<button data-action=remind data-id="${id}"
          u2-confirm="${t`Make the next reminder of it now?`}">${t`Remind`}</button>`
        : ""}
      ${row.type === "proforma" && row.status === "open"
        ? html.async`<button data-action=finalize data-id="${id}"
          u2-confirm="${t`Turn it into the invoice now? It is issued, and its tax is due.`}">
          ${t`Make the invoice`}</button>`
        : ""}
      ${claims && ["open", "paid", "uncollectible"].includes(String(row.status))
        ? html.async`<button data-action=credit data-id="${id}">${t`Credit note`}</button>`
        : ""}
      ${claims && row.status === "open"
        ? html.async`<button data-action=writeOff data-id="${id}"
          u2-confirm="${t`Write off what is left? The loss is booked and its tax taken back.`}">
          ${t`Write off`}</button>`
        : ""}
      ${row.status === "open" && !Number(row.paid) && !credit ? html.async`<button data-action=revise data-id="${id}"
        u2-confirm="${t`Revise it? It is canceled, and a draft with its content opens.`}">${t`Revise`}</button>` : ""}
      ${row.status !== "canceled" ? html.async`<button data-action=cancel data-id="${id}"
        u2-confirm="${row.sent && claims && Number(row.total)
          ? t`Cancel this invoice? It went out: a credit note over all of it takes it back.`
          : t`Cancel this invoice? Its number stays used.`}">${t`Cancel`}</button>` : ""}
    </div>
    ${row.direction === "out" && row.status !== "canceled" && app.modules.linked("messaging.email") ? html.async`
    <form data-send="${id}">
      <input type=email name=email value="${emailOf(app, row.usr_id)}" placeholder="${t`Email address`}">
      <button>${t`Send by email`}</button>
    </form>` : ""}
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Party`}</div>
    <address style="white-space:pre-line">${[
      party.legalName || party.name,
      address.streetAddress,
      [address.postalCode, address.addressLocality].filter(Boolean).join(" "),
      address.addressCountry,
      party.vatID && `VAT ${party.vatID}`,
      party.iban && `IBAN ${party.iban}`,
    ].filter(Boolean).join("\n")}</address>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Lines`}</div>
    <div style="overflow:auto; max-height:70vh; padding:0"><table class=u2-table>
      <thead><tr>
        <th>${t`Description`}
        <th>${t`Quantity`}
        <th>${t`Unit price`}
        <th>${t`Tax`}
        <th>${t`Amount`}
      <tbody>${items.map((line) => html`<tr>
        <td>${line.name}${line.description ? html`<br><small>${line.description}</small>` : ""}
        <td style="text-align:end">${Number(line.quantity)} ${line.unit}
        <td style="text-align:end">${money(line.price, row.currency)}
        <td style="text-align:end">${Number(line.tax_rate)} %
          ${line.tax_category === "S" ? "" : html`<small>${line.tax_category}</small>`}
        <td style="text-align:end">${money(line.amount, row.currency)}`)}
    </table></div>
  </div>
  ${listed.length ? html.async`<div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Reminded invoices`}</div>
    <table class=u2-table>${listed.map((l) => html.async`<tr>
      <td><a href="${backend.toUrl(pageUrl, { invoice: l.id })}">${l.number || `#${l.id}`}</a>
      <td>${t`Due`} ${l.due}
      <td style="text-align:end">${money(l.open, row.currency)}
      <td>${l.level}.`)}</table>
  </div>` : ""}
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Payments`} <small>ref ${refOf(id)}</small></div>
    ${payments.length ? html.async`<table class=u2-table>${payments.map((p) => html.async`<tr>
      <td>${rowLink(node, "cms.backend.fin.payment", "payment", p.id)}
      <td>${direction(p.direction, p.direction)} ${p.provider}
      <td style="text-align:end">${money(p.amount, p.currency)}
      <td style="text-align:end">${money(Number(p.paid) - Number(p.refunded), p.currency)}
      <td style="text-align:end" title="${t`What of it went to this`}">
        ${p.share == null ? "" : money(p.share, p.currency)}
      <td>${status(p.status)}`)}</table>` : html.async`<p>${t`No payments yet`}`}
    ${ways.length && !waiting ? html.async`<form data-request="${id}">
      ${t`Ask for`} ${money(open, row.currency)}:
      <select name=method>${ways.map((w) => html`<option value="${w.method}">${w.label}`)}</select>
      <button>${t`Create payment`}</button>
    </form>` : ""}
    ${["open", "uncollectible"].includes(String(row.status)) && open > 0 ? html.async`<form data-record="${id}">
      ${credit ? t`Paid back` : row.direction === "in" ? t`Paid by hand` : t`Received by hand`}:
      <input name=amount inputmode=decimal size=8 placeholder="${money(open, row.currency)}">
      <input name=provider value=bank size=8 list="sources-${id}">${sources(app, `sources-${id}`)}
      <button>${t`Record`}</button>
    </form>` : ""}
    ${credit && row.status === "open" && open > 0 && row.usr_id && app.modules.linked("fin.payment.credit")
      ? html.async`<button data-action=tocredit data-id="${id}"
        u2-confirm="${t`Put what is owed onto the customer's credit?`}">
        ${t`To credit`} ${money(open, row.currency)}</button>`
      : ""}
  </div>
  ${row.direction === "in" ? original(node, row) : ""}
  ${row.direction === "in" ? "" : html.async`<div class=u2-card style="flex:1 1 auto; min-width:40rem">
    <div class=-head>${t`Document`}</div>
    <iframe data-sheets srcdoc="${preview}" style="width:100%; height:70rem; border:0; padding:0"></iframe>
  </div>`}
</div>`;
}

/** A customer's latest invoices, as card on their page (`backendRowWidget`); "" without any. */
export async function userInvoices(app: App, id: unknown, page: Node): Promise<HtmlString | string> {
  const t = app.t;
  const [rows, count] = await Promise.all([
    app.db.query`SELECT * FROM invoice WHERE usr_id = ${id} ORDER BY id DESC LIMIT 10`,
    app.db.one`SELECT COUNT(*) FROM invoice WHERE usr_id = ${id}`.then(Number),
  ]);
  if (!rows.length) return "";
  const pageUrl = await page.url();
  const all = count > rows.length
    ? html.async`<p><a href="${backend.toUrl(pageUrl, { usr: id })}">${t`All`} ${count} ${t`invoices`}</a>`
    : "";
  return html.async`<table class=u2-table style="white-space:nowrap">${rows.map((row) => html.async`<tr>
    <td><a href="${backend.toUrl(pageUrl, { invoice: row.id })}">${row.number || `#${row.id}`}</a>
    <td>${direction(row.direction, row.direction === "out" ? t`issued` : t`received`)}
    <td>${row.date}
    <td style="text-align:end">${money(row.total, row.currency)}
    <td>${status(row.status)}`)}
  </table>${all}`;
}
