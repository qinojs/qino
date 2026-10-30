import { requestStorage, unixTime } from "@qino/qino";
import { addDays, today } from "@qino/qino/fin";
import { cancel as cancelPayment, create as pay, sample, slip } from "@qino/qino/fin.payment";
import { render } from "@qino/qino/pdf";

import { document as htmlOf, inLang, languageOf, mail as mailOf } from "./lib/document.ts";
import { draw } from "./lib/number.ts";
import { credited, settledOf } from "./lib/credit.ts";
import { CATEGORIES, lineOf, totals } from "./lib/totals.ts";

import type { App, DbFile, Row } from "@qino/qino";
import type { Payer } from "@qino/qino/fin.payment";
import type { Line } from "./lib/totals.ts";

export type { Line } from "./lib/totals.ts";
export { CATEGORIES, lineOf, round, totals } from "./lib/totals.ts";

/** What a document is: an invoice, a credit note, a pro forma invoice, a reminder. */
export type Type = "invoice" | "credit_note" | "proforma" | "reminder";

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
  /** `null` clears it again. */
  date?: string | null;
  due?: string | null;
  /** Days to pay; `null` takes the default (`fin.invoice.term`) again. */
  term?: number | null;
  number?: string;
  lang?: string;
  /** What other modules keep with it, e.g. what was read from a received invoice. */
  data?: Record<string, unknown>;
};

/** Run `fn` in the language of a document, with the texts recipients read (namespace `fin`): what
 *  is written onto it, such as a reminder's fee, reads as the document does. */
export const inLanguage = <T>(app: App, invoice: Row, fn: () => Promise<T>): Promise<T> =>
  inLang(app, languageOf(app, invoice), fn);

/** The `ref` its payments carry. */
export const refOf = (id: number): string => `fin.invoice:${id}`;

/** The invoice a `ref` names, if it names one. */
const idOf = (ref: unknown): number | undefined => {
  const id = Number(String(ref ?? "").split(":")[1]);
  return ref === refOf(id) ? id : undefined;
};

/** Its party as the payer of its payments: a slip prints it. */
export function payerOf(invoice: Row): Payer | undefined {
  const party = JSON.parse(String(invoice.party ?? "null"));
  return party?.name ? { name: String(party.legalName || party.name), address: party.address } : undefined;
}

/** A new draft. `in` is an invoice received: it keeps the sender's `number`. `listed`: the documents
 *  it lists, with what is open on them and their reminder level — a reminder's overdue invoices. */
export async function create(
  app: App,
  values: Values & {
    direction?: "in" | "out";
    type?: Type;
    preceding?: number;
    listed?: { id: number; open: number; level: number }[];
  },
): Promise<number> {
  const time = unixTime();
  return await app.db.transaction(async () => {
    const id = Number(await app.db.table("invoice").insert({
      direction: values.direction ?? "out",
      type: values.type ?? "invoice",
      preceding: values.preceding ?? null,
      status: "draft",
      currency: values.currency,
      lang: values.lang ?? requestStorage.getStore()?.lang ?? app.languages.def,
      created: time,
      changed: time,
    }));
    await write(app, id, values);
    const listed = app.db.table("invoice_listed");
    for (const item of values.listed ?? []) {
      await listed.insert({ invoice_id: id, listed_id: item.id, open: item.open, level: item.level });
    }
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

/** Number formats of the types that do not count on with the invoices unless set so. */
const FORMATS: Partial<Record<Type, string>> = { proforma: "P{year}-{n}", reminder: "M{year}-{n}" };

/** The number format of a type: its own setting (`creditNumber`, `proformaNumber`, `reminderNumber`),
 *  its default, else the invoices' (`number`). */
async function formatOf(app: App, type: Type) {
  const s = app.settings["fin.invoice"];
  const own = {
    invoice: undefined, credit_note: s.creditNumber, proforma: s.proformaNumber, reminder: s.reminderNumber,
  };
  return String(await own[type] || FORMATS[type] || await s.number || "{year}-{n}");
}

/**
 * Make a draft owed: `open`. An outgoing one draws its number now — numbers follow the order of
 * issuing, without gaps, each type in its own sequence. The date defaults to today, the due date to
 * the date plus the term — the invoice's own, else `fin.invoice.term`.
 */
export async function issue(app: App, id: number): Promise<Row | undefined> {
  return await app.db.transaction(async () => {
    const invoice = await get(app, id);
    if (invoice?.status !== "draft") throw new Error("fin.invoice: only drafts can be issued");
    const credit = invoice.type === "credit_note";
    if (credit && Number(invoice.total) >= 0) {
      throw new Error("fin.invoice: a credit note gives back — its total is below zero");
    }
    const date = String(invoice.date ?? today());
    const term = invoice.term ?? Number(await app.settings["fin.invoice"].term ?? 30);
    const out = invoice.direction === "out";
    const number = out ? await draw(app, await formatOf(app, invoice.type as Type), date) : invoice.number;
    // a due date given stands; else it follows from the term, which is kept to be printed
    // a credit note asks for no payment: no due date, no term
    const fixed = credit ? {} : invoice.due ? { due: invoice.due } : { due: addDays(date, Number(term)), term };
    await app.db.table("invoice").update(id, { number, date, ...fixed, changed: unixTime() });
    return status(app, invoice, "open");
  }).then(async (issued) => {
    if (!issued) return;
    // outside the transaction: a provider may be asked over the network
    if (issued.type === "credit_note") await settle(app, Number(issued.preceding ?? id));
    else {
      if (!Number(issued.total)) await settle(app, id); // nothing owed of its own: paid as issued
      await ask(app, id).catch((e) => console.error(`fin.invoice: no payment asked for ${id}`, e));
    }
    return get(app, id);
  });
}

/** The payment an issued document of ours asks for, by the method set (`fin.invoice.method`), over
 *  all it asks for (`owed`): its slip — a QR bill — then goes with it. */
async function ask(app: App, id: number) {
  const invoice = await get(app, id);
  const method = String(await app.settings["fin.invoice"].method ?? "");
  const amount = invoice ? await owed(app, invoice) : 0;
  if (!method || invoice?.direction !== "out" || amount <= 0) return;
  await pay(app, {
    method,
    amount,
    currency: String(invoice.currency),
    ref: refOf(id),
    description: String(invoice.number),
    usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
    payer: payerOf(invoice),
    return: "/",
  });
}

/** What an issued document asks for: what is open on it, and on the open ones it lists — a reminder
 *  without fees asks for its invoices all the same. A credit note asks for nothing, nor a pro forma
 *  that is done (`paid`). */
export async function owed(app: App, invoice: Row): Promise<number> {
  if (invoice.type === "credit_note" || ["draft", "canceled"].includes(String(invoice.status))) return 0;
  const listed = Number(await app.db.one`SELECT COALESCE(SUM(i.total - i.paid), 0)
    FROM invoice_listed l JOIN invoice i ON i.id = l.listed_id
    WHERE l.invoice_id = ${invoice.id} AND i.status IN ('open', 'uncollectible')`);
  const own = invoice.status === "paid" ? 0 : Math.max(0, Number(invoice.total) - Number(invoice.paid));
  return own + listed;
}

/** Throw a draft away; it has no number yet, so nothing is skipped. */
export async function remove(app: App, id: number): Promise<void> {
  const invoice = await get(app, id);
  if (invoice?.status !== "draft") throw new Error("fin.invoice: only drafts can be removed");
  // through the table: what hangs on it by schema (its lines, a subscription's periods) goes with it
  await app.db.table("invoice").delete(id);
}

/**
 * Correct an issued invoice nobody has paid yet: it is canceled (see `cancel`) and a draft with the
 * same content takes its place, to be changed and issued anew. A received one's draft keeps what
 * was read and a copy of its original: the canceled one keeps its own.
 */
export async function revise(app: App, id: number): Promise<number> {
  const invoice = await get(app, id);
  if (invoice?.status !== "open" || Number(invoice.paid)) {
    throw new Error("fin.invoice: only open invoices nothing was paid on can be revised");
  }
  // one transaction: the draft, its copy of the original and the cancel, or nothing
  return await app.db.transaction(async () => {
    const draft = await create(app, {
      ...copyOf(invoice, (await lines(app, id)).map(lineOf)),
      direction: invoice.direction === "in" ? "in" : "out",
      // a credit note is revised into a credit note, for the same invoice
      type: invoice.type as Type,
      preceding: invoice.preceding == null ? undefined : Number(invoice.preceding),
      text: invoice.text == null ? undefined : String(invoice.text),
      term: invoice.term == null ? undefined : Number(invoice.term),
      number: invoice.direction === "in" ? String(invoice.number ?? "") || undefined : undefined,
      data: invoice.data ? JSON.parse(String(invoice.data)) : undefined,
    });
    // a row of its own on the same content: replacing it in the draft leaves the canceled one's
    const original = invoice.direction === "in" && invoice.file_id
      ? await (await app.dbFiles.file(Number(invoice.file_id))).exists()
      : undefined;
    if (original) await attach(app, draft, await original.clone());
    await cancel(app, id);
    return draft;
  });
}

/**
 * Withdraw an invoice. One of ours that went out is taken back by a credit note over all of it — a
 * document that names it and revokes it (MWSTG 27 IV) —, and counts as settled by it. Anything else
 * is `canceled`; its number stays used.
 */
export async function cancel(app: App, id: number): Promise<Row | undefined> {
  const invoice = await get(app, id);
  if (!invoice || invoice.status === "canceled") return invoice;
  const revoked = invoice.sent && invoice.direction === "out" && Number(invoice.total)
    && ["invoice", "reminder"].includes(String(invoice.type)) && invoice.status !== "draft";
  if (revoked) {
    if (await credited(app, id)) {
      throw new Error("fin.invoice: partly credited already — take back the rest by a credit note");
    }
    await issue(app, await creditNote(app, id));
    return get(app, id);
  }
  const canceled = await status(app, invoice, "canceled");
  // a credit note taken back no longer counts on its invoice
  if (invoice.type === "credit_note" && invoice.preceding) await settle(app, Number(invoice.preceding));
  return canceled;
}

/** Give up what is left on an issued invoice of ours: `uncollectible`. Bookkeeping books the loss and
 *  takes its tax back (MWSTG 41). Money that comes after all still settles it. */
export async function writeOff(app: App, id: number): Promise<Row | undefined> {
  const invoice = await get(app, id);
  const claims = ["invoice", "reminder"].includes(String(invoice?.type));
  if (invoice?.status !== "open" || invoice.direction !== "out" || !claims) {
    throw new Error("fin.invoice: only open invoices of ours are written off");
  }
  return status(app, invoice, "uncollectible");
}

/**
 * Turn an issued pro forma into its invoice: the same content, issued, dated `date` — when its money
 * came, the day its tax arises (MWSTG 40 I c) — or today. The pro forma is done then (`paid`).
 * Resolves with the invoice; asked again, with the one made before.
 */
export async function finalize(app: App, id: number, { date }: { date?: string } = {}): Promise<number> {
  const proforma = await get(app, id);
  if (proforma?.type !== "proforma" || proforma.status === "draft" || proforma.status === "canceled") {
    throw new Error("fin.invoice: only issued pro forma invoices are finalized");
  }
  const made = await successor(app, id);
  if (made) return made;
  const draft = await create(app, {
    ...copyOf(proforma, (await lines(app, id)).map(lineOf)),
    type: "invoice",
    preceding: id,
    text: proforma.text == null ? undefined : String(proforma.text),
    term: proforma.term == null ? undefined : Number(proforma.term),
    date: date ?? today(),
  });
  await issue(app, draft);
  await status(app, proforma, "paid");
  return draft;
}

/** The invoice a pro forma became. */
const successor = async (app: App, id: number) => {
  const found = await app.db.one`SELECT id FROM invoice
    WHERE preceding = ${id} AND type = 'invoice' AND status <> 'canceled' ORDER BY id`;
  return found == null ? undefined : Number(found);
};

/** The document as HTML in its language — the default layout; a site with its own passes its HTML
 *  to `print`. The slip of each open payment for it (a QR bill) is appended. */
export async function document(app: App, id: number): Promise<string> {
  const invoice = await get(app, id);
  if (!invoice) throw new Error(`fin.invoice: no invoice ${id}`);
  const open = await app.db.col`
    SELECT id FROM payment WHERE ref = ${refOf(id)} AND status IN ('pending', 'processing') ORDER BY id`;
  const method = String(await app.settings["fin.invoice"].method ?? "");
  // a draft has no payment yet: it shows the slip it will get, or says where it will be; a credit
  // note asks for nothing
  const promised = invoice.status === "draft" && method && invoice.direction === "out"
    && invoice.type !== "credit_note";
  const listed = await listedOf(app, id);
  // made in the document's language, so the slips speak it too
  const slips = async () => promised
    ? [await sample(app, method, {
      amount: Number(invoice.total) + listed.reduce((sum, row) => sum + Number(row.open), 0),
      currency: String(invoice.currency),
      payer: payerOf(invoice),
    })
      ?? `<p>${await app.t`The payment slip is added when the invoice is issued.`}</p>`]
    : (await Promise.all(open.map((payment) => slip(app, Number(payment))))).filter((s) => s != null);
  // a credit note names the invoice it corrects, an invoice the pro forma it follows
  const preceded = invoice.preceding
    ? await app.db.one`SELECT number FROM invoice WHERE id = ${invoice.preceding}`
    : undefined;
  return htmlOf(app, { ...invoice, preceded }, await lines(app, id), listed, slips);
}

/** What a document lists, as it was then: number, date and due of each, what was open on it and
 *  its reminder level. */
export const listedOf = (app: App, id: number): Promise<Row[]> => app.db.query`
  SELECT i.id, i.number, i.date, i.due, l.open, l.level FROM invoice_listed l JOIN invoice i ON i.id = l.listed_id
  WHERE l.invoice_id = ${id} ORDER BY i.due, i.id`;

/**
 * Print it to a PDF and keep that as its file: the document as sent. Printing again replaces it —
 * until it went out (`sent`): from then on it stays as it is (OR 958f). Only its user (`usr_id`) may
 * download it.
 */
export async function print(app: App, id: number, { html }: { html?: string } = {}): Promise<DbFile> {
  const invoice = await get(app, id);
  if (!invoice || invoice.status === "draft") throw new Error("fin.invoice: only issued invoices are printed");
  // a received invoice's file is the original, the receipt: it is never replaced by a print
  if (invoice.direction === "in") throw new Error("fin.invoice: a received invoice keeps its original");
  if (invoice.sent && invoice.file_id) throw new Error("fin.invoice: it went out — its PDF stays as sent");
  const bytes = await render(app, html ?? await document(app, id));
  const name = `${String(invoice.number || id).replace(/[^\w.-]+/g, "_")}.pdf`;
  const pdf = await app.dbFiles.add(new File([bytes], name, { type: "application/pdf" }));
  await app.db.table("invoice").update(id, { file_id: pdf.id, changed: unixTime() });
  await release(app, invoice.file_id);
  return pdf;
}

/** A draft credit note for an issued invoice or reminder of ours: its lines, to be cut down to what
 *  is given back. Issued, it counts on the invoice as paid. */
export async function creditNote(app: App, id: number): Promise<number> {
  const invoice = await get(app, id);
  const issued = ["open", "paid", "uncollectible"].includes(String(invoice?.status));
  if (!["invoice", "reminder"].includes(String(invoice?.type)) || invoice?.direction !== "out" || !issued) {
    throw new Error("fin.invoice: credit notes are for issued invoices of ours");
  }
  // what it gives back: the lines negative, to be cut down
  const given = (await lines(app, id)).map((row) => ({ ...lineOf(row), quantity: -Number(row.quantity) }));
  return await create(app, { ...copyOf(invoice, given), type: "credit_note", preceding: id });
}

/** What a draft made from an invoice takes over — currency, party, user, ref, language — with `lines`. */
const copyOf = (invoice: Row, lines: Line[]) => ({
  currency: String(invoice.currency),
  lines,
  taxIncluded: Boolean(invoice.tax_included),
  party: JSON.parse(String(invoice.party ?? "{}")) ?? undefined,
  usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
  ref: invoice.ref == null ? undefined : String(invoice.ref),
  lang: String(invoice.lang ?? "") || undefined,
});

/**
 * The mail an issued document is sent with — subject, text and its PDF, in its language — for any
 * channel to deliver (`messaging.email`). Printed first if it has no PDF yet.
 */
export async function mail(app: App, id: number) {
  const invoice = await get(app, id);
  if (!invoice || invoice.status === "draft" || invoice.direction !== "out") {
    throw new Error("fin.invoice: only issued invoices are sent");
  }
  const pdf = invoice.file_id ? await app.dbFiles.file(Number(invoice.file_id)) : await print(app, id);
  return await mailOf(app, { ...invoice, owed: await owed(app, invoice) }, pdf, await listedOf(app, id));
}

/**
 * Send it with its PDF (`messaging.email`): to `email`, else to its user. The first time it reaches
 * someone is when it was `sent`. Resolves whether it did.
 */
export async function send(app: App, id: number, { email }: { email?: string } = {}): Promise<boolean> {
  const invoice = await get(app, id);
  const to = email ? { email } : invoice?.usr_id ? { usr: Number(invoice.usr_id) } : undefined;
  if (!to || !app.modules.linked("messaging.email")) return false;
  const messaging = await import("@qino/qino/messaging.email");
  if (!await messaging.send(app, to, await mail(app, id))) return false;
  await app.db.exec`UPDATE invoice SET sent = ${today()} WHERE id = ${id} AND sent IS NULL`;
  return true;
}

/** Say when it was sent — by post, from elsewhere — or `null`: not yet. */
export async function setSent(app: App, id: number, date: string | null): Promise<void> {
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("dates are YYYY-MM-DD");
  await app.db.exec`UPDATE invoice SET sent = ${date}, changed = ${unixTime()} WHERE id = ${id}`;
}

/**
 * Keep the original a received invoice came as — the receipt, kept unchanged. A draft may get
 * another one; an issued invoice only one where it has none yet, so what was booked stays.
 */
export async function attach(app: App, id: number, file: DbFile): Promise<Row | undefined> {
  const invoice = await get(app, id);
  if (!invoice) throw new Error(`fin.invoice: no invoice ${id}`);
  if (invoice.status !== "draft" && invoice.file_id) throw new Error("fin.invoice: an issued invoice keeps its file");
  await app.db.table("invoice").update(id, { file_id: file.id, changed: unixTime() });
  await release(app, invoice.file_id);
  return get(app, id);
}

/** Its lines, in order. */
export const lines = (app: App, id: number): Promise<Row[]> =>
  app.db.query`SELECT * FROM invoice_line WHERE invoice_id = ${id} ORDER BY sort, id`;

/**
 * Spread what a payment moved over the documents it is for: the one its `ref` names first — a
 * reminder's own fees and interest before the debt (OR 85) —, then the open ones it lists, the
 * oldest due first (OR 87); each up to what is open on it, the rest to the named one (overpaid). Only
 * money in the document's direction counts: in for ours, out for theirs and for our credit notes. A
 * pro forma's money goes to its invoice, made now if need be. Called on `payment:change`; safe to
 * call any time.
 */
export async function allocate(app: App, payment: Row): Promise<void> {
  const before = await app.db.col`SELECT invoice_id FROM invoice_payment WHERE payment_id = ${payment.id}`;
  await app.db.exec`DELETE FROM invoice_payment WHERE payment_id = ${payment.id}`;
  const moved = Number(payment.paid) - Number(payment.refunded);
  let invoice = await get(app, idOf(payment.ref) ?? 0);
  if (invoice?.type === "proforma" && invoice.status !== "draft") {
    const id = Number(invoice.id);
    const made = await successor(app, id)
      ?? (moved > 0 ? await finalize(app, id, { date: payment.date as string }) : 0);
    invoice = made ? await get(app, made) : undefined;
  }
  const shares = new Map<number, number>();
  const inward = invoice && (invoice.direction === "out") !== (invoice.type === "credit_note");
  if (invoice && moved && payment.direction === (inward ? "in" : "out")) {
    // paid ones too: one this very payment paid before keeps its share; what is open caps each
    const listed = await app.db.query`SELECT i.* FROM invoice_listed l JOIN invoice i ON i.id = l.listed_id
      WHERE l.invoice_id = ${invoice.id} AND i.status IN ('open', 'paid', 'uncollectible') ORDER BY i.due, i.id`;
    let rest = moved;
    for (const target of listed.length ? [invoice, ...listed] : []) {
      const share = Math.min(rest, Math.max(0, await openOf(app, target)));
      if (share > 0) shares.set(Number(target.id), share);
      rest -= share;
    }
    shares.set(Number(invoice.id), (shares.get(Number(invoice.id)) ?? 0) + rest);
    const table = app.db.table("invoice_payment");
    for (const [id, amount] of shares) await table.insert({ invoice_id: id, payment_id: payment.id, amount });
  }
  for (const id of new Set([...before.map(Number), ...shares.keys()])) await settle(app, id);
}

/** What is open on a document by what is assigned to it: its total less its payments and credit notes. */
const openOf = async (app: App, invoice: Row) => Number(invoice.total) - await paymentsOf(app, Number(invoice.id))
  - await credited(app, Number(invoice.id));

const paymentsOf = (app: App, id: number) =>
  app.db.one`SELECT COALESCE(SUM(amount), 0) FROM invoice_payment WHERE invoice_id = ${id}`.then(Number);

/**
 * Take over what is assigned to it: `paid` is its payments (`allocate`) and credit notes, whatever
 * the payments' status — a QR bill paid in part is still `processing`, yet its money counts. Settled
 * once that reaches the total; a refund below reopens it. Safe to call any time.
 */
export async function settle(app: App, id: number): Promise<Row | undefined> {
  const invoice = await get(app, id);
  if (!invoice) return;
  const credit = invoice.type === "credit_note";
  const payments = await paymentsOf(app, id);
  const paid = credit ? await settledOf(app, invoice, payments) : payments + await credited(app, id);
  await app.db.exec`UPDATE invoice SET paid = ${paid}, changed = ${unixTime()} WHERE id = ${id}`;
  // a pro forma is done by its invoice, not by money; drafts and canceled ones keep their status
  if (invoice.type === "proforma" || !["open", "paid", "uncollectible"].includes(String(invoice.status))) {
    return get(app, id);
  }
  // settled once what moved reaches the total — below zero for a credit note
  const total = Number(invoice.total);
  const settled = credit ? paid <= total : paid >= total;
  const unsettled = invoice.status === "uncollectible" ? "uncollectible" : "open";
  const fresh = await status(app, invoice, settled ? "paid" : unsettled);
  if (fresh?.status === "paid") {
    // paid another way: what still waits for it, or for a reminder listing it, asks for nothing owed
    const listing = await app.db.col`SELECT invoice_id FROM invoice_listed WHERE listed_id = ${id}`;
    for (const doc of [id, ...listing.map(Number)]) await withdraw(app, doc);
  }
  // what its credit notes still owe follows from what was paid here
  if (!credit) {
    const credits = await app.db.col`SELECT id FROM invoice
      WHERE preceding = ${id} AND type = 'credit_note' AND status IN ('open', 'paid')`;
    for (const note of credits) await settle(app, Number(note));
  }
  return fresh;
}

/** Withdraw the payments still waiting for a document (a QR bill, a payment page) once it asks for nothing. */
async function withdraw(app: App, id: number) {
  const invoice = await get(app, id);
  if (!invoice || invoice.type === "credit_note" || await owed(app, invoice) > 0) return;
  const waiting = await app.db.col`SELECT id FROM payment WHERE ref = ${refOf(id)} AND status = 'pending'`;
  for (const payment of waiting) await cancelPayment(app, Number(payment));
}

const get = (app: App, id: number): Promise<Row | undefined> => app.db.row`SELECT * FROM invoice WHERE id = ${id}`;

/** Remove a file the invoice no longer holds — unless something still uses it: an entry's receipt. */
async function release(app: App, id: unknown) {
  const file = id ? await app.dbFiles.file(Number(id)) : undefined;
  if (file && !await file.used()) await file.remove().catch(() => {});
}

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
  for (const key of ["ref", "text", "date", "due", "number", "lang", "term"] as const) {
    if (values[key] !== undefined) fields[key] = values[key];
  }
  const taxIncluded = values.taxIncluded ?? Boolean(invoice?.tax_included);
  const stored = values.lines ?? (values.taxIncluded == null ? undefined : (await lines(app, id)).map(lineOf));
  // a line without a rate takes the default one (fin.invoice.taxRate); without a category it is
  // taxed normally (S), or not subject to tax (O) where it has no rate
  const rate = Number(await app.settings["fin.invoice"].taxRate ?? 0) || 0;
  const given = stored?.map((line) => {
    const taxRate = line.taxRate ?? rate;
    return { ...line, taxRate, taxCategory: line.taxCategory ?? (taxRate ? "S" : "O") };
  });
  if (given) {
    for (const line of given) {
      if (![line.price, line.quantity ?? 1, line.taxRate].every(Number.isFinite)) {
        throw new Error("price, quantity and taxRate must be numbers");
      }
      if (!CATEGORIES.includes(line.taxCategory)) throw new Error(`taxCategory is one of ${CATEGORIES.join(", ")}`);
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
        tax_rate: line.taxRate,
        tax_category: line.taxCategory,
        account: line.account || null, // kept where fin.accounting adds the column
        amount: sum.amounts[sort],
      });
    }
  }
  await app.db.table("invoice").update(id, fields);
}
