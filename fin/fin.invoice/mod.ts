import { requestStorage, unixTime } from "@qino/qino";

import { cancel as cancelPayment, create as pay, sample, slip } from "@qino/qino/fin.payment";
import { render } from "@qino/qino/pdf";

import { document as htmlOf } from "./lib/document.ts";
import { draw } from "./lib/number.ts";
import { lineOf, totals } from "./lib/totals.ts";

import type { App, DbFile, Row } from "@qino/qino";
import type { Line } from "./lib/totals.ts";

export type { Line } from "./lib/totals.ts";

/** What an invoice holds. `party` is the other side as printed, shaped like `identity.organization`
 *  (`name`, `legalName`, `address` { `streetAddress`, `postalCode`, `addressLocality`,
 *  `addressCountry` … }, `vatID`, `taxID`; `iban` for one received), kept as it was even if the
 *  user changes later. Dates are `YYYY-MM-DD`; `lang` defaults to the request's language. */
type Values = {
  currency: string;
  lines: Line[];
  taxIncluded?: boolean;
  party?: Record<string, unknown>;
  usrId?: number | null;
  ref?: string;
  text?: string;
  date?: string;
  due?: string;
  /** Days to pay; `null` takes the default (`fin.invoice.term`) again. */
  term?: number | null;
  number?: string;
  lang?: string;
  /** What other modules keep with it, e.g. what was read from a received invoice. */
  data?: Record<string, unknown>;
};

/** The `ref` its payments carry. */
export const refOf = (id: number): string => `fin.invoice:${id}`;

/** A new draft. `in` is an invoice received: it keeps the sender's `number`. */
export async function create(app: App, values: Values & { direction?: "in" | "out" }): Promise<number> {
  const time = unixTime();
  return await app.db.transaction(async () => {
    const id = Number(await app.db.table("invoice").insert({
      direction: values.direction ?? "out",
      status: "draft",
      currency: values.currency,
      lang: values.lang ?? requestStorage.getStore()?.lang ?? app.languages.def,
      created: time,
      changed: time,
    }));
    await write(app, id, values);
    return id;
  });
}

/** Change a draft; lines, if given, replace the old ones. */
export async function update(app: App, id: number, values: Partial<Values>): Promise<void> {
  await app.db.transaction(async () => {
    const invoice = await get(app, id);
    if (invoice?.status !== "draft") throw new Error("fin.invoice: only drafts can be changed");
    await write(app, id, values, invoice);
  });
}

/**
 * Make a draft owed: `open`. An outgoing one draws its number now — numbers follow the order of
 * issuing, without gaps. The date defaults to today, the due date to the date plus the term — the
 * invoice's own, else `fin.invoice.term`.
 */
export async function issue(app: App, id: number): Promise<Row | undefined> {
  return await app.db.transaction(async () => {
    const invoice = await get(app, id);
    if (invoice?.status !== "draft") throw new Error("fin.invoice: only drafts can be issued");
    const s = app.settings["fin.invoice"];
    const date = String(invoice.date ?? today());
    const term = invoice.term ?? Number(await s.term ?? 30);
    const format = String(await s.number || "{year}-{n}");
    const number = invoice.direction === "out" ? await draw(app, format, date) : invoice.number;
    // a due date given stands; else it follows from the term, which is kept to be printed
    const fixed = invoice.due ? { due: invoice.due } : { due: addDays(date, Number(term)), term };
    await app.db.table("invoice").update(id, { number, date, ...fixed, changed: unixTime() });
    return status(app, invoice, "open");
  }).then(async (issued) => {
    // outside the transaction: a provider may be asked over the network
    if (issued) await ask(app, issued).catch((e) => console.error(`fin.invoice: no payment asked for ${id}`, e));
    return get(app, id);
  });
}

/** The payment an issued invoice asks for, by the method set (`fin.invoice.method`): its slip — a
 *  QR bill — then goes with the invoice. */
async function ask(app: App, invoice: Row) {
  const method = String(await app.settings["fin.invoice"].method ?? "");
  if (!method || invoice.direction !== "out" || !Number(invoice.total)) return;
  await pay(app, {
    method,
    amount: Number(invoice.total),
    currency: String(invoice.currency),
    ref: refOf(Number(invoice.id)),
    description: String(invoice.number),
    usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
    return: "/",
  });
}

/** Throw a draft away; it has no number yet, so nothing is skipped. */
export async function remove(app: App, id: number): Promise<void> {
  const invoice = await get(app, id);
  if (invoice?.status !== "draft") throw new Error("fin.invoice: only drafts can be removed");
  await app.db.transaction(async () => {
    await app.db.exec`DELETE FROM invoice_line WHERE invoice_id = ${id}`;
    await app.db.exec`DELETE FROM invoice WHERE id = ${id}`;
  });
}

/**
 * Correct an issued invoice nobody has paid yet: it is canceled (its number stays used) and a
 * draft with the same content takes its place, to be changed and issued anew.
 */
export async function revise(app: App, id: number): Promise<number> {
  const invoice = await get(app, id);
  if (invoice?.status !== "open" || Number(invoice.paid)) {
    throw new Error("fin.invoice: only open invoices nothing was paid on can be revised");
  }
  const draft = await create(app, {
    direction: invoice.direction === "in" ? "in" : "out",
    currency: String(invoice.currency),
    lines: (await lines(app, id)).map(lineOf),
    taxIncluded: Boolean(invoice.tax_included),
    party: JSON.parse(String(invoice.party ?? "{}")) ?? undefined,
    usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
    ref: invoice.ref == null ? undefined : String(invoice.ref),
    text: invoice.text == null ? undefined : String(invoice.text),
    term: invoice.term == null ? undefined : Number(invoice.term),
    number: invoice.direction === "in" ? String(invoice.number ?? "") || undefined : undefined,
    lang: String(invoice.lang ?? "") || undefined,
  });
  await cancel(app, id);
  return draft;
}

/** Withdraw an invoice; its number stays used. */
export async function cancel(app: App, id: number): Promise<Row | undefined> {
  const invoice = await get(app, id);
  if (!invoice || invoice.status === "canceled") return invoice;
  return status(app, invoice, "canceled");
}

/** The invoice as an HTML document in its language — the default layout; a site with its own
 *  passes its HTML to `print`. The slip of each open payment for it (a QR bill) is appended. */
export async function document(app: App, id: number): Promise<string> {
  const invoice = await get(app, id);
  if (!invoice) throw new Error(`fin.invoice: no invoice ${id}`);
  const open = await app.db.col`
    SELECT id FROM payment WHERE ref = ${refOf(id)} AND status IN ('pending', 'processing') ORDER BY id`;
  const method = String(await app.settings["fin.invoice"].method ?? "");
  // a draft has no payment yet: it shows the slip it will get, or says where it will be
  const promised = invoice.status === "draft" && method && invoice.direction === "out";
  // made in the document's language, so the slips speak it too
  const slips = async () => promised
    ? [await sample(app, method, { amount: Number(invoice.total), currency: String(invoice.currency) })
      ?? `<p>${await app.t`The payment slip is added when the invoice is issued.`}</p>`]
    : (await Promise.all(open.map((payment) => slip(app, Number(payment))))).filter((s) => s != null);
  return htmlOf(app, invoice, await lines(app, id), slips);
}

/**
 * Print it to a PDF and keep that as its file: the document as sent, unchanged by later edits of
 * layout or identity. Printing again replaces it. Only its user (`usr_id`) may download it.
 */
export async function print(app: App, id: number, { html }: { html?: string } = {}): Promise<DbFile> {
  const invoice = await get(app, id);
  if (!invoice || invoice.status === "draft") throw new Error("fin.invoice: only issued invoices are printed");
  // a received invoice's file is the original, the receipt: it is never replaced by a print
  if (invoice.direction === "in") throw new Error("fin.invoice: a received invoice keeps its original");
  const bytes = await render(app, html ?? await document(app, id));
  const name = `${String(invoice.number || id).replace(/[^\w.-]+/g, "_")}.pdf`;
  const pdf = await app.dbFiles.add(new File([bytes], name, { type: "application/pdf" }));
  const old = invoice.file_id;
  await app.db.table("invoice").update(id, { file_id: pdf.id, changed: unixTime() });
  if (old) await (await app.dbFiles.file(Number(old)))?.remove().catch(() => {});
  return pdf;
}

/**
 * Keep the original a received invoice came as — the receipt, kept unchanged. A draft may get
 * another one; an issued invoice only one where it has none yet, so what was booked stays.
 */
export async function attach(app: App, id: number, file: DbFile): Promise<Row | undefined> {
  const invoice = await get(app, id);
  if (!invoice) throw new Error(`fin.invoice: no invoice ${id}`);
  if (invoice.status !== "draft" && invoice.file_id) throw new Error("fin.invoice: an issued invoice keeps its file");
  const old = invoice.file_id;
  await app.db.table("invoice").update(id, { file_id: file.id, changed: unixTime() });
  if (old && Number(old) !== file.id) await (await app.dbFiles.file(Number(old)))?.remove().catch(() => {});
  return get(app, id);
}

/** Its lines, in order. */
export const lines = (app: App, id: number): Promise<Row[]> =>
  app.db.query`SELECT * FROM invoice_line WHERE invoice_id = ${id} ORDER BY sort, id`;

/**
 * Take over what its payments say: incoming money settles an outgoing invoice, outgoing money an
 * incoming one. `paid` is what moved, whatever the status — a QR bill paid in part is still
 * `processing`, yet its money counts. Called on `payment:change`; safe to call any time.
 */
export async function settle(app: App, id: number): Promise<Row | undefined> {
  const invoice = await get(app, id);
  if (!invoice) return;
  const paid = Number(await app.db.one`
    SELECT COALESCE(SUM(paid - refunded), 0) FROM payment
    WHERE ref = ${refOf(id)} AND direction = ${invoice.direction === "out" ? "in" : "out"}`);
  await app.db.exec`UPDATE invoice SET paid = ${paid}, changed = ${unixTime()} WHERE id = ${id}`;
  if (invoice.status !== "open" && invoice.status !== "paid") return get(app, id);
  const fresh = await status(app, invoice, paid >= Number(invoice.total) ? "paid" : "open");
  // paid another way: a QR bill or a payment page still waiting asks for what is no longer owed
  if (fresh?.status === "paid") {
    const waiting = await app.db.col`SELECT id FROM payment WHERE ref = ${refOf(id)} AND status = 'pending'`;
    for (const payment of waiting) await cancelPayment(app, Number(payment));
  }
  return fresh;
}

const get = (app: App, id: number): Promise<Row | undefined> => app.db.row`SELECT * FROM invoice WHERE id = ${id}`;

/** Change the status; conditional on the one read, so a change fires `invoice:status` once. */
async function status(app: App, invoice: Row, to: string): Promise<Row | undefined> {
  const changed = to === invoice.status ? undefined : await app.db.exec`
    UPDATE invoice SET status = ${to}, changed = ${unixTime()}
    WHERE id = ${invoice.id} AND status = ${invoice.status}`;
  const fresh = await get(app, Number(invoice.id));
  if (changed?.affectedRows) await app.fire("invoice:status", { invoice: fresh, previous: invoice.status });
  return fresh;
}

/** Store the fields given and, with lines, the lines and the totals. */
async function write(app: App, id: number, values: Partial<Values>, invoice?: Row) {
  if (values.currency != null && !/^[A-Z]{3}$/.test(values.currency)) {
    throw new Error("currency must be an ISO 4217 code");
  }
  for (const date of [values.date, values.due]) {
    if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("dates are YYYY-MM-DD");
  }
  const fields: Record<string, unknown> = { changed: unixTime() };
  if (values.currency != null) fields.currency = values.currency;
  if (values.taxIncluded != null) fields.tax_included = values.taxIncluded;
  if (values.party != null) fields.party = JSON.stringify(values.party);
  if (values.data != null) fields.data = JSON.stringify(values.data);
  if (values.usrId !== undefined) fields.usr_id = values.usrId;
  for (const key of ["ref", "text", "date", "due", "number", "lang"] as const) {
    if (values[key] != null) fields[key] = values[key];
  }
  if (values.term !== undefined) fields.term = values.term;
  const taxIncluded = values.taxIncluded ?? Boolean(invoice?.tax_included);
  const given = values.lines ?? (values.taxIncluded == null ? undefined : (await lines(app, id)).map(lineOf));
  if (given) {
    for (const line of given) {
      if (![line.price, line.quantity ?? 1, line.taxRate ?? 0].every(Number.isFinite)) {
        throw new Error("price, quantity and taxRate must be numbers");
      }
    }
    const sum = totals(given, taxIncluded);
    Object.assign(fields, { net: sum.net, tax: sum.tax, total: sum.total });
    await app.db.exec`DELETE FROM invoice_line WHERE invoice_id = ${id}`;
    const table = app.db.table("invoice_line");
    for (const [sort, line] of given.entries()) {
      await table.insert({
        invoice_id: id,
        sort,
        name: line.name,
        description: line.description || null,
        quantity: line.quantity ?? 1,
        unit: line.unit ?? null,
        price: line.price,
        tax_rate: line.taxRate ?? 0,
        amount: sum.amounts[sort],
      });
    }
  }
  await app.db.table("invoice").update(id, fields);
}

/** Today on the server's calendar. */
const today = () => new Date().toLocaleDateString("sv-SE");

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
