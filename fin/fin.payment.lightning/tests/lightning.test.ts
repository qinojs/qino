import { assertEquals, assertStringIncludes } from "@std/assert";
import { create, slip, sync } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { withFetch } from "../../tests/fetch.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.payment.lightning"], async (app) => {
    await app.settings["fin.payment.lightning"].url("https://lnbits.test");
    await app.settings["fin.payment.lightning"].invoiceKey("ik1");
    await fn(app);
  });

/** An LNbits wallet whose one invoice is paid when the test says so. */
function lnbits(state: { paid: boolean }) {
  return (url: URL) => {
    if (url.pathname === "/api/v1/payments") return { payment_hash: "hash1", bolt11: "lnbc4726n1ptest" };
    if (url.pathname === "/api/v1/payments/hash1") return { paid: state.paid };
  };
}

Deno.test("a Lightning invoice in the payment's currency, its slip, and paid once LNbits says so", async () => {
  await withApp(async (app) => {
    const state = { paid: false };
    await withFetch(lnbits(state), async (calls) => {
      const { id, redirect } = await create(app, { method: "lightning", amount: 4726, currency: "CHF", description: "Order 1", return: "/done" });
      assertStringIncludes(redirect, "/payment/pay/");
      const asked = calls[0].body as Record<string, unknown>;
      assertEquals([asked.out, asked.amount, asked.unit, asked.expiry], [false, 47.26, "CHF", 3600]);
      assertStringIncludes(String(asked.webhook), "/payment/notify/"); // LNbits tells us, we ask again
      assertEquals(calls[0].url.host, "lnbits.test");
      assertStringIncludes((await slip(app, id))!, "lnbc4726n1ptest");

      // the payer's page looks again until it is paid, then leads back
      const page = await app.fetch(new Request(`https://shop.test${new URL(redirect).pathname}`));
      assertStringIncludes(await page.text(), 'http-equiv="refresh"');
      state.paid = true;
      const done = await app.fetch(new Request(`https://shop.test${new URL(redirect).pathname}`));
      assertEquals([done.status, done.headers.get("location")], [302, "https://shop.test/done"]);
      assertEquals((await sync(app, id))?.status, "paid");
    });
  });
});

Deno.test("an invoice nobody paid in time expires", async () => {
  await withApp(async (app) => {
    await withFetch(lnbits({ paid: false }), async () => {
      const { id } = await create(app, { method: "lightning", amount: 100, currency: "CHF", return: "/" });
      await app.db.exec`UPDATE payment SET data = ${JSON.stringify({ bolt11: "x", until: 1 })} WHERE id = ${id}`;
      assertEquals((await sync(app, id))?.status, "expired");
    });
  });
});
