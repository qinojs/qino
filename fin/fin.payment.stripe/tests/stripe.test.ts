import { assertEquals, assertStringIncludes } from "@std/assert";
import { create, refund, sync } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { withFetch } from "../../tests/fetch.ts";

import type { App } from "@qino/qino";
import type { Call } from "../../tests/fetch.ts";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.payment.stripe"], async (app) => {
    await app.settings["fin.payment.stripe"].secretKey("sk_test_1");
    await app.settings["fin.payment.stripe"].webhookSecret("whsec_1");
    await fn(app);
  });

/** Stripe with one session whose state the test sets. Form bodies are noted as text. */
function stripe(session: Record<string, unknown>, bodies: string[]) {
  return (url: URL, call: Call) => {
    if (call.body) bodies.push(String(call.body));
    if (url.pathname === "/v1/checkout/sessions") return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" };
    if (url.pathname === "/v1/checkout/sessions/cs_1") return { id: "cs_1", ...session };
    if (url.pathname === "/v1/refunds") return { id: "re_1" };
  };
}

Deno.test("a Checkout session in minor units; paid with its fee, refunded through its intent", async () => {
  await withApp(async (app) => {
    const session: Record<string, unknown> = { status: "open", payment_status: "unpaid" };
    const bodies: string[] = [];
    await withFetch(stripe(session, bodies), async (calls) => {
      const { id, redirect } = await create(app, { method: "stripe", amount: 4726, currency: "CHF", title: "Order 1", return: "/" });
      assertEquals(redirect, "https://checkout.stripe.test/cs_1");
      const sent = new URLSearchParams(bodies[0]);
      assertEquals(sent.get("line_items[0][price_data][unit_amount]"), "4726");
      assertEquals(sent.get("line_items[0][price_data][currency]"), "chf");
      assertEquals(sent.get("metadata[payment]"), String(id));
      assertStringIncludes(String(sent.get("success_url")), "/payment/return/");
      assertEquals(calls[0].url.host, "api.stripe.com");

      assertEquals((await sync(app, id))?.status, "pending");
      const charge = { amount_refunded: 0, balance_transaction: { currency: "chf", fee: 167 } };
      Object.assign(session, { status: "complete", payment_status: "paid", amount_total: 4726, payment_intent: { id: "pi_1", latest_charge: charge } });
      const paid = await sync(app, id);
      assertEquals([paid?.status, paid?.paid, paid?.fee], ["paid", 4726, 167]);
      await refund(app, id, 1000);
      assertEquals(new URLSearchParams(bodies.at(-1)).get("payment_intent"), "pi_1");
    });
  });
});

Deno.test("a webhook counts only with Stripe's signature", async () => {
  await withApp(async (app) => {
    const session: Record<string, unknown> = { status: "open", payment_status: "unpaid" };
    await withFetch(stripe(session, []), async () => {
      const { id } = await create(app, { method: "stripe", amount: 1000, currency: "CHF", return: "/" });
      Object.assign(session, { status: "complete", payment_status: "paid", amount_total: 1000 });
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", metadata: { payment: String(id) } } } });
      const sign = async (secret: string) => {
        const bytes = (text: string) => new TextEncoder().encode(text);
        const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        return `t=1,v1=${new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes(`1.${body}`))).toHex()}`;
      };
      const post = async (signature: string) => (await app.fetch(new Request("https://shop.test/payment/webhook/stripe", {
        method: "POST", body, headers: { "content-type": "application/json", "stripe-signature": signature },
      }))).text();
      await post(await sign("whsec_wrong"));
      assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${id}`, "pending");
      await post(await sign("whsec_1"));
      assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${id}`, "paid");
    });
  });
});
