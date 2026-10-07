import { errMsg } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { toMinor } from "@qino/qino/cms.backend.superuser.fin";
import { cancel, create, document, issue, print, refOf, remove, revise, update } from "@qino/qino/fin.invoice";
import { create as pay, record } from "@qino/qino/fin.payment";

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
      await update(app, Number(v.id), valuesOf(v));
      return { ok: true, html: await document(app, Number(v.id)) };
    }
    const { action, id } = (vars.action ?? {}) as { action?: string; id?: string };
    if (action === "issue") {
      const issued = await issue(app, Number(id));
      return { ok: true, message: `${await t`Issued as`} ${issued?.number ?? ""}` };
    }
    if (action === "cancel") return { ok: !!await cancel(app, Number(id)), message: await t`Canceled.` };
    if (action === "print") return { ok: !!await print(app, Number(id)), message: await t`Printed.` };
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
        title: `${invoice.title || await t`Invoice`} ${invoice.number ?? ""}`.trim(),
        usrId: invoice.usr_id == null ? undefined : Number(invoice.usr_id),
        return: await pageUrl({ invoice: id }),
      });
      return { ok: true, message: `${await t`Payment`} #${payment.id}: ${payment.redirect}` };
    }
    if (vars.record) {
      const { id, amount, provider } = vars.record as { id: string; amount: string; provider: string };
      const invoice = await app.db.row`SELECT * FROM invoice WHERE id = ${Number(id)}`;
      if (!invoice) return { ok: false, message: await t`No invoice` };
      const currency = String(invoice.currency);
      await record(app, {
        direction: invoice.direction === "out" ? "in" : "out",
        provider: provider || "bank",
        amount: amount ? toMinor(amount, currency) : Number(invoice.total) - Number(invoice.paid),
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

/** The editor's fields as invoice values: lines without a description are empty rows, an emptied
 *  field is cleared. `ref` is not among them: what an invoice is for is set by the code that makes
 *  it, and kept. */
function valuesOf(v: Record<string, string>) {
  const currency = String(v.currency ?? "").toUpperCase();
  const decimal = (value: string) => Number(String(value).replace(",", "."));
  const lines = Object.keys(v).filter((key) => /^title\d+$/.test(key) && v[key]).map((key) => {
    const i = key.slice(5);
    return {
      title: v[key],
      qty: v[`qty${i}`] ? decimal(v[`qty${i}`]) : 1,
      unit: v[`unit${i}`] || undefined,
      price: toMinor(v[`price${i}`] || 0, currency),
      taxRate: v[`taxRate${i}`] ? decimal(v[`taxRate${i}`]) : 0,
    };
  });
  const address = Object.fromEntries(["streetAddress", "postalCode", "addressLocality", "addressCountry"]
    .filter((key) => v[key]).map((key) => [key, key === "addressCountry" ? v[key].toUpperCase() : v[key]]));
  return {
    currency,
    lines,
    gross: v.gross === "1",
    party: { name: v.name ?? "", address, ...v.vatID ? { vatID: v.vatID } : {} },
    usrId: Number(v.usrId) || null,
    title: v.title ?? "",
    text: v.text ?? "",
    date: v.date || undefined,
    due: v.due || undefined,
    lang: v.lang || undefined,
    number: v.number,
  };
}
