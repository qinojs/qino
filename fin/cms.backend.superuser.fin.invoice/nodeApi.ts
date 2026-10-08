import { errMsg } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { fileOf, parseAmount } from "@qino/qino/cms.backend.superuser.fin";
import { partyOf } from "@qino/qino/fin";
import {
  attach, cancel, create, creditNote, document, issue, mail, payerOf, print, refOf, remove, revise, update,
} from "@qino/qino/fin.invoice";
import { create as pay, record } from "@qino/qino/fin.payment";
import { render } from "@qino/qino/pdf";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — whoever may open this backend page may act on invoices. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  const pageUrl = async (params: Record<string, unknown>) => backend.toUrl(await (await node.page()).url(), params);
  try {
    if (vars.create) {
      const { direction, currency } = vars.create as Record<string, string>;
      const kind = direction === "in" ? "in" : "out";
      const id = await create(app, { direction: kind, currency: currency.toUpperCase(), lines: [] });
      return { ok: true, url: await pageUrl({ invoice: id }) };
    }
    // the editor saves as one types, and gets the invoice back as it will be printed
    if (vars.save) {
      const v = vars.save as Record<string, string>;
      const values = valuesOf(v);
      // a credit note is typed as what it gives back, stored negative
      const draft = await app.db.row`SELECT type FROM invoice WHERE id = ${Number(v.id)}`;
      if (draft?.type === "credit_note") for (const line of values.lines) line.quantity = -line.quantity;
      await update(app, Number(v.id), values);
      return { ok: true, html: await document(app, Number(v.id)) };
    }
    // a draft as PDF, to look at: made on request, not kept
    if (vars.pdf) return { ok: true, pdf: (await render(app, await document(app, Number(vars.pdf)))).toBase64() };
    // a user picked as a draft's party: their name, address and language, as editor fields
    if (vars.usr) {
      const u = await app.db.row`SELECT * FROM usr WHERE id = ${Number(vars.usr)}`;
      if (!u) return { ok: false, message: await t`No user` };
      const { name, address } = partyOf(u);
      // every field, an empty one too: what was typed before is replaced
      const empty = { streetAddress: "", postalCode: "", addressLocality: "", addressRegion: "", addressCountry: "" };
      return { name, ...empty, ...address, lang: String(u.lang ?? "") };
    }
    // by mail, with its PDF: to the address typed, else to its user's
    if (vars.send) {
      const { id, email } = vars.send as Record<string, string>;
      const invoice = await app.db.row`SELECT usr_id FROM invoice WHERE id = ${Number(id)}`;
      const to = email ? { email } : invoice?.usr_id ? { usr: Number(invoice.usr_id) } : undefined;
      if (!to) return { ok: false, message: await t`No address to send it to` };
      const { send } = await import("@qino/qino/messaging.email");
      const reached = await send(app, to, await mail(app, Number(id)));
      if (!reached) return { ok: false, message: await t`Not sent: no email address` };
      return { ok: true, message: await t`Sent.` };
    }
    if (vars.attach) {
      const { id, file } = vars.attach as { id: string; file: { name: string; type: string; data: string } };
      await attach(app, Number(id), await fileOf(app, file));
      return { ok: true };
    }
    const { action, id } = (vars.action ?? {}) as { action?: string; id?: string };
    if (action === "issue") {
      const issued = await issue(app, Number(id));
      return { ok: true, message: `${await t`Issued as`} ${issued?.number ?? ""}` };
    }
    if (action === "cancel") return { ok: !!await cancel(app, Number(id)), message: await t`Canceled.` };
    if (action === "credit") {
      return { ok: true, url: await pageUrl({ invoice: await creditNote(app, Number(id)) }) };
    }
    // what a credit note owes, onto the customer's credit: paid out, through the credit provider
    if (action === "tocredit") {
      const note = await app.db.row`SELECT * FROM invoice WHERE id = ${Number(id)}`;
      const owed = Number(note?.paid) - Number(note?.total); // its rest is negative: what we owe
      if (note?.type !== "credit_note" || !note.usr_id || owed <= 0) {
        return { ok: false, message: await t`Nothing owed` };
      }
      const { payOut } = await import("@qino/qino/fin.payment.credit");
      await payOut(app, Number(note.usr_id), {
        amount: owed,
        currency: String(note.currency),
        ref: refOf(Number(id)),
        text: String(note.number ?? ""),
      });
      return { ok: true, message: await t`Put onto the credit.` };
    }
    if (action === "print") return { ok: !!await print(app, Number(id)), message: await t`Printed.` };
    if (action === "remind") {
      const { remind } = await import("@qino/qino/fin.invoice.reminder");
      const level = await remind(app, Number(id));
      return level
        ? { ok: true, message: `${await t`Reminder sent`}: ${level}` }
        : { ok: false, message: await t`No reminder sent: no user with an email address, or all are sent` };
    }
    if (action === "remove") {
      await remove(app, Number(id));
      return { ok: true, url: await pageUrl({}) };
    }
    if (action === "revise") return { ok: true, url: await pageUrl({ invoice: await revise(app, Number(id)) }) };
    if (vars.request) {
      const { id, method } = vars.request as { id: string; method: string };
      const invoice = await app.db.row`SELECT * FROM invoice WHERE id = ${Number(id)}`;
      if (!invoice) return { ok: false, message: await t`No invoice` };
      const payment = await pay(app, {
        method,
        amount: Number(invoice.total) - Number(invoice.paid),
        currency: String(invoice.currency),
        ref: refOf(Number(id)),
        description: `${await t`Invoice`} ${invoice.number ?? ""}`.trim(),
        usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
        payer: payerOf(invoice),
        return: await pageUrl({ invoice: id }),
      });
      return { ok: true, message: `${await t`Payment`} #${payment.id}: ${payment.redirect}` };
    }
    if (vars.record) {
      const { id, amount, provider } = vars.record as { id: string; amount: string; provider: string };
      const invoice = await app.db.row`SELECT * FROM invoice WHERE id = ${Number(id)}`;
      if (!invoice) return { ok: false, message: await t`No invoice` };
      const currency = String(invoice.currency);
      // money comes in for our invoices; it goes out for the others, and for a credit note of ours
      const credit = invoice.type === "credit_note";
      await record(app, {
        direction: (invoice.direction === "out") !== credit ? "in" : "out",
        provider: provider || "bank",
        amount: amount ? parseAmount(amount, currency) : Math.abs(Number(invoice.total) - Number(invoice.paid)),
        currency,
        ref: refOf(Number(id)),
      });
      return { ok: true, message: await t`Recorded.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

/** The editor's fields as invoice values: lines without a name are empty rows, an emptied
 *  field is cleared. `ref` is not among them: what an invoice is for is set by the code that makes
 *  it, and kept. */
function valuesOf(v: Record<string, string>) {
  const currency = String(v.currency ?? "").toUpperCase();
  const decimal = (value: string) => Number(String(value).replace(",", "."));
  const lines = Object.keys(v).filter((key) => /^name\d+$/.test(key) && v[key]).map((key) => {
    const i = key.slice(4);
    return {
      name: v[key],
      description: v[`description${i}`] || undefined,
      account: v[`account${i}`] || undefined,
      quantity: v[`quantity${i}`] ? decimal(v[`quantity${i}`]) : 1,
      unit: v[`unit${i}`] || undefined,
      price: parseAmount(v[`price${i}`] || 0, currency),
      taxRate: v[`taxRate${i}`] ? decimal(v[`taxRate${i}`]) : undefined, // empty: the default
    };
  });
  const keys = ["streetAddress", "postalCode", "addressLocality", "addressRegion", "addressCountry"];
  const address = Object.fromEntries(keys
    .filter((key) => v[key]).map((key) => [key, key === "addressCountry" ? v[key].toUpperCase() : v[key]]));
  return {
    currency,
    lines,
    taxIncluded: v.taxIncluded === "1",
    party: { name: v.name ?? "", address, ...v.vatID ? { vatID: v.vatID } : {} },
    usrId: Number(v.usrId) || null,
    text: v.text ?? "",
    // a field the form has, emptied, clears it; one it lacks leaves it
    date: v.date === undefined ? undefined : v.date || null,
    due: v.due === undefined ? undefined : v.due || null,
    term: v.term === undefined ? undefined : v.term === "" ? null : Number(v.term),
    lang: v.lang || undefined,
    number: v.number,
  };
}
