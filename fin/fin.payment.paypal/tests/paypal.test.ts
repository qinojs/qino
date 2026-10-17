import { assertEquals } from "@std/assert";
import { create, refund, sync } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { withFetch } from "../../tests/fetch.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.payment.paypal"], async (app) => {
    await app.settings["fin.payment.paypal"].clientId("client1");
    await app.settings["fin.payment.paypal"].secret("secret1");
    await fn(app);
  });

const capture = {
  id: "cap1",
  status: "COMPLETED",
  amount: { currency_code: "CHF", value: "47.26" },
  seller_receivable_breakdown: { paypal_fee: { currency_code: "CHF", value: "1.84" } },
};

/** PayPal's sandbox with one order whose status the test sets. */
function paypal(order: { status: string }) {
  return (url: URL) => {
    if (url.pathname === "/v1/oauth2/token") return { access_token: "token1" };
    if (url.pathname === "/v2/checkout/orders") return { id: "ord1", links: [{ rel: "payer-action", href: "https://paypal.test/approve/ord1" }] };
    if (url.pathname === "/v2/checkout/orders/ord1") return { id: "ord1", status: order.status };
    if (url.pathname === "/v2/checkout/orders/ord1/capture") {
      order.status = "COMPLETED";
      return { id: "ord1", status: "COMPLETED", purchase_units: [{ payments: { captures: [capture] } }] };
    }
    if (url.pathname === "/v2/payments/captures/cap1/refund") return { id: "ref1", status: "COMPLETED" };
  };
}

Deno.test("an order approved on PayPal is captured on return, with PayPal's fee, and refunded by its capture", async () => {
  await withApp(async (app) => {
    const order = { status: "PAYER_ACTION_REQUIRED" };
    await withFetch(paypal(order), async (calls) => {
      const { id, redirect } = await create(app, { method: "paypal", amount: 4726, currency: "CHF", description: "Order 1", return: "/" });
      assertEquals(redirect, "https://paypal.test/approve/ord1");
      const created = calls.find((c) => c.url.pathname === "/v2/checkout/orders")!;
      const unit = (created.body as { purchase_units: { amount: unknown; custom_id: string }[] }).purchase_units[0];
      assertEquals([unit.amount, unit.custom_id], [{ currency_code: "CHF", value: "47.26" }, String(id)]);
      assertEquals(created.url.host, "api-m.sandbox.paypal.com"); // the sandbox until live is set

      assertEquals((await sync(app, id))?.status, "pending");
      order.status = "APPROVED";
      const paid = await sync(app, id);
      assertEquals([paid?.status, paid?.paid, paid?.fee], ["paid", 4726, 184]);
      await refund(app, id, 1000);
      const back = calls.at(-1)!;
      assertEquals([back.url.pathname, back.body], ["/v2/payments/captures/cap1/refund", { amount: { currency_code: "CHF", value: "10.00" } }]);
    });
  });
});

Deno.test("a webhook only names the order, which is asked", async () => {
  await withApp(async (app) => {
    const order = { status: "PAYER_ACTION_REQUIRED" };
    await withFetch(paypal(order), async () => {
      const { id } = await create(app, { method: "paypal", amount: 4726, currency: "CHF", return: "/" });
      order.status = "APPROVED";
      const body = JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ord1", status: "COMPLETED" } });
      await app.fetch(new Request("https://shop.test/payment/webhook/paypal", { method: "POST", body, headers: { "content-type": "application/json" } }));
      assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${id}`, "paid"); // captured by asking
    });
  });
});
