import { create, issue, refOf as invoiceRef } from "@qino/qino/fin.invoice";
import { idOf, refOf } from "@qino/qino/cms.shop";

import type { App, Row } from "@qino/qino";
import type { Order } from "@qino/qino/cms.shop";

/** The invoice of an order, if it has one. */
const invoiceOf = async (app: App, order: Order): Promise<number | undefined> => {
  const id = await app.db.one`SELECT id FROM invoice WHERE ref = ${refOf(Number(order.$id))} AND type = ${"invoice"} ORDER BY id DESC`;
  return id == null ? undefined : Number(id);
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // deno-lint-ignore no-explicit-any -- payloads are declared by cms.shop and fin.invoice
  const on = (event: string, fn: (e: any) => unknown) => app.on(event, fn as never, { signal });

  // Every placed order is invoiced: its lines one to one, issued at once.
  on("shop:ordered", async ({ order }: { order: Order }) => {
    const lines = (await order.lines()).map((l) => ({
      name: l.name, description: l.description || undefined, quantity: Number(l.quantity), price: Number(l.price),
      taxRate: Number(l.tax_rate), taxCategory: l.tax_category || undefined,
    }));
    for (const extra of await order.extras()) lines.push({ name: extra.name, description: undefined, quantity: 1, price: extra.price, taxRate: extra.taxRate, taxCategory: extra.taxCategory });
    const party = order.party("bill");
    const id = await create(app, {
      currency: order.currency,
      lang: order.lang,
      usrId: order.usr_id ?? undefined,
      taxIncluded: !!order.tax_included,
      party: party?.name ? { name: party.name, address: party.address ?? {} } : undefined,
      lines,
      ref: refOf(Number(order.$id)),
    });
    await issue(app, id);
  });

  // Paying an order pays its invoice.
  on("shop:pay", async ({ order, payment }: { order: Order; payment: { ref: string } }) => {
    const id = await invoiceOf(app, order);
    if (id) payment.ref = invoiceRef(id);
  });

  // The invoice paid, the order is paid.
  on("invoice:status", async ({ invoice }: { invoice: Row }) => {
    const id = idOf(invoice.ref);
    if (!id || invoice.status !== "paid") return;
    const order = await app.db.table("shop_order").get<Order>(id);
    if (order?.status === "ordered") await order.setStatus("paid");
  });
}
