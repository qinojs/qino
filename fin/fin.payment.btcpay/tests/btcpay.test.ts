import { assertEquals, assertStringIncludes } from "@std/assert";
import { create, sync } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { withFetch } from "../../tests/fetch.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.payment.btcpay"], async (app) => {
    const s = app.settings["fin.payment.btcpay"];
    await s.url("https://btcpay.test/");
    await s.storeId("store1");
    await s.apiKey("key1");
    await s.webhookSecret("secret1");
    await fn(app);
  });

/** BTCPay with one invoice whose state the test sets. */
function btcpay(invoice: Record<string, unknown>) {
  return (url: URL) => {
    if (url.pathname === "/api/v1/stores/store1/invoices") return { id: "inv1", checkoutLink: "https://btcpay.test/i/inv1" };
    if (url.pathname === "/api/v1/stores/store1/invoices/inv1") return { id: "inv1", ...invoice };
  };
}

Deno.test("an invoice is made at BTCPay and its status taken over, paid in part and late too", async () => {
  await withApp(async (app) => {
    const state: Record<string, unknown> = { status: "New", additionalStatus: "None", paidAmount: "0" };
    await withFetch(btcpay(state), async (calls) => {
      const { id, redirect } = await create(app, { method: "btcpay", amount: 4726, currency: "CHF", description: "Order 1", return: "/" });
      assertEquals(redirect, "https://btcpay.test/i/inv1");
      const { checkout, ...invoice } = calls[0].body as { checkout: { redirectURL: string } };
      assertEquals(invoice, { amount: "47.26", currency: "CHF", metadata: { orderId: String(id), itemDesc: "Order 1" } });
      assertStringIncludes(checkout.redirectURL, "https://shop.test/payment/return/"); // back through us
      assertEquals(calls[0].url.host, "btcpay.test");
      const status = async () => (await sync(app, id))?.status;
      Object.assign(state, { status: "Expired", additionalStatus: "PaidPartial", paidAmount: "20.00" });
      assertEquals(await status(), "processing");
      Object.assign(state, { status: "Settled", additionalStatus: "None", paidAmount: "47.26" });
      assertEquals(await status(), "paid");
      assertEquals(Number(await app.db.one`SELECT paid FROM payment WHERE id = ${id}`), 4726);
    });
  });
});

Deno.test("a webhook counts only with BTCPay's signature, and only names the invoice", async () => {
  await withApp(async (app) => {
    const state: Record<string, unknown> = { status: "New", paidAmount: "0" };
    await withFetch(btcpay(state), async () => {
      const { id } = await create(app, { method: "btcpay", amount: 1000, currency: "CHF", return: "/" });
      Object.assign(state, { status: "Settled", paidAmount: "10.00" });
      const body = JSON.stringify({ type: "InvoiceSettled", invoiceId: "inv1", storeId: "store1" });
      const bytes = (text: string) => new TextEncoder().encode(text);
      const sign = async (secret: string) => {
        const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        return "sha256=" + new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes(body))).toHex();
      };
      const post = async (signature: string) => (await app.fetch(new Request("https://shop.test/payment/webhook/btcpay", {
        method: "POST", body, headers: { "content-type": "application/json", "btcpay-sig": signature },
      }))).text();
      assertStringIncludes(await post(await sign("wrong")), "ok");
      assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${id}`, "pending"); // forged: nothing synced
      await post(await sign("secret1"));
      assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${id}`, "paid");
    });
  });
});
