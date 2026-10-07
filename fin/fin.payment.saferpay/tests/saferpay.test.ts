import { assertEquals, assertRejects } from "@std/assert";
import { fakeSettings } from "@qino/qino/tests";

import { paymentProvider as saferpay } from "../plugin.ts";

import type { App, Row } from "@qino/qino";

type Call = { host: string; path: string; body: Record<string, unknown> };

/** Saferpay answers per path from `answers`; an answer with `ErrorName` is a refusal. */
async function withSaferpay(
  answers: Record<string, unknown>,
  fn: (app: App, calls: Call[]) => Promise<void>,
  settings: Record<string, unknown> = {},
) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^.*\/Payment\/v1\//, "");
    calls.push({ host: url.host, path, body: JSON.parse(String(init?.body)) });
    const answer = answers[path] as Record<string, unknown> | undefined;
    return Promise.resolve(Response.json(answer ?? {}, { status: answer?.ErrorName ? 402 : 200 }));
  };
  const credentials = { customerId: "123", terminalId: "17000001", user: "u", password: "p" };
  const app = { settings: fakeSettings({ "fin.payment.saferpay": { ...credentials, ...settings } }) } as unknown as App;
  try {
    await fn(app, calls);
  } finally {
    globalThis.fetch = original;
  }
}

const row = (values: Record<string, unknown> = {}) => ({
  id: 7, amount: 4990, currency: "CHF", status: "pending", paid: 0, refunded: 0, data: '{"token":"tok"}', ...values,
}) as Row;

const tx = (status: string, extra: Record<string, unknown> = {}) => ({
  Transaction: { Id: "tx1", Status: status, Amount: { Value: "4990", CurrencyCode: "CHF" }, ...extra },
  PaymentMeans: { Brand: { PaymentMethod: "TWINT" } },
});

const offer = { amount: 1, currency: "CHF" };

Deno.test("methods follow the setting, or leave the choice to Saferpay's page", async () => {
  await withSaferpay({}, async (app) => {
    assertEquals(await saferpay.methods(app, offer), [{ name: "", label: "Saferpay" }]);
  });
  await withSaferpay({}, async (app) => {
    assertEquals((await saferpay.methods(app, offer)).map((m) => m.name), ["twint", "visa"]);
  }, { methods: "TWINT, visa" });
});

Deno.test("start initializes the payment page with our addresses and keeps the token", async () => {
  const answers = { "PaymentPage/Initialize": { Token: "tok", RedirectUrl: "https://pay.test/x" } };
  await withSaferpay(answers, async (app, calls) => {
    const urls = { back: "https://site.test/payment/return/7-x", notify: "https://site.test/payment/notify/7-x" };
    const state = await saferpay.start(app, row({ method: "twint", title: "Order 12" }), urls);
    assertEquals(state, { redirect: "https://pay.test/x", externalId: "tok", data: { token: "tok" } });
    const { body } = calls[0];
    assertEquals((body.RequestHeader as Record<string, unknown>).CustomerId, "123");
    const amount = { Value: "4990", CurrencyCode: "CHF" };
    assertEquals(body.Payment, { Amount: amount, OrderId: "7", Description: "Order 12" });
    assertEquals([body.PaymentMethods, body.ReturnUrl], [["TWINT"], { Url: urls.back }]);
    assertEquals(body.Notification, { SuccessNotifyUrl: urls.notify, FailNotifyUrl: urls.notify });
  });
});

Deno.test("an authorized payment is captured and paid", async () => {
  const answers = {
    "PaymentPage/Assert": tx("AUTHORIZED"),
    "Transaction/Capture": { CaptureId: "cap1", Status: "CAPTURED" },
  };
  await withSaferpay(answers, async (app, calls) => {
    assertEquals(await saferpay.sync(app, row()), {
      status: "paid",
      paid: 4990,
      externalId: "tx1",
      method: "twint",
      data: { token: "tok", transaction: "tx1", capture: "cap1" },
    });
    assertEquals(calls.map((c) => c.path), ["PaymentPage/Assert", "Transaction/Capture"]);
  });
});

Deno.test("a payment Saferpay captured itself is taken over without capturing again", async () => {
  await withSaferpay({ "PaymentPage/Assert": tx("CAPTURED", { CaptureId: "cap0" }) }, async (app, calls) => {
    const state = await saferpay.sync(app, row());
    assertEquals([state.status, state.data?.capture], ["paid", "cap0"]);
    assertEquals(calls.length, 1);
  });
});

Deno.test("refusals end the payment, an unfinished one stays, our own errors are thrown", async () => {
  const refuse = (ErrorName: string) => ({ "PaymentPage/Assert": { ErrorName } });
  const cases: [string, unknown][] = [
    ["TRANSACTION_NOT_STARTED", undefined],
    ["TOKEN_EXPIRED", "expired"],
    ["TRANSACTION_ABORTED", "canceled"],
    ["TRANSACTION_DECLINED", "failed"],
  ];
  for (const [code, status] of cases) {
    await withSaferpay(refuse(code), async (app) => assertEquals((await saferpay.sync(app, row())).status, status));
  }
  await withSaferpay(refuse("AUTHENTICATION_FAILED"), async (app) => {
    await assertRejects(() => saferpay.sync(app, row()), Error, "AUTHENTICATION_FAILED");
  });
});

Deno.test("a concurrent capture leaves the result to the one that won", async () => {
  const answers = {
    "PaymentPage/Assert": tx("AUTHORIZED"),
    "Transaction/Capture": { ErrorName: "TRANSACTION_ALREADY_CAPTURED" },
  };
  await withSaferpay(answers, async (app) => assertEquals(await saferpay.sync(app, row()), {}));
});

Deno.test("a settled payment is not asked again", async () => {
  await withSaferpay({}, async (app, calls) => {
    assertEquals(await saferpay.sync(app, row({ status: "paid" })), {});
    assertEquals(calls, []);
  });
});

Deno.test("a refund is authorized against the capture, then captured", async () => {
  const answers = {
    "Transaction/Refund": { Transaction: { Id: "ref1", Status: "AUTHORIZED" } },
    "Transaction/Capture": { Status: "CAPTURED" },
  };
  await withSaferpay(answers, async (app, calls) => {
    await saferpay.refund!(app, row({ status: "paid", paid: 4990, data: '{"capture":"cap1"}' }), 1000);
    assertEquals(calls.map((c) => [c.path, c.body.CaptureReference ?? c.body.TransactionReference]), [
      ["Transaction/Refund", { CaptureId: "cap1" }],
      ["Transaction/Capture", { TransactionId: "ref1" }],
    ]);
    assertEquals(calls[0].body.Refund, { Amount: { Value: "1000", CurrencyCode: "CHF" } });
  });
});

Deno.test("without credentials nothing is sent", async () => {
  await withSaferpay({}, async (app, calls) => {
    await assertRejects(() => saferpay.sync(app, row()), Error, "required");
    assertEquals(calls, []);
  }, { password: "" });
});

Deno.test("the test environment is the default, live only when set", async () => {
  const answers = { "PaymentPage/Assert": tx("PENDING") };
  for (const [live, host] of [[undefined, "test.saferpay.com"], [true, "www.saferpay.com"]]) {
    await withSaferpay(answers, async (app, calls) => {
      await saferpay.sync(app, row());
      assertEquals(calls[0].host, host);
    }, { live });
  }
});
