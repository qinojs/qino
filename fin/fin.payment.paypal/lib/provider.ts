import { errMsg, isOn } from "@qino/qino";
import { currency as currencies } from "@qino/qino/locale.currency";

import type { App, Row } from "@qino/qino";
import type { Provider, State } from "@qino/qino/fin.payment";

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
async function settings(app: App) {
  const s = app.settings["fin.payment.paypal"];
  const [clientId, secret, live] = await Promise.all([s.clientId, s.secret, s.live]);
  return {
    clientId: String(clientId ?? "").trim(),
    secret: String(secret ?? "").trim(),
    base: isOn(live) ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

/** A call with a fresh access token: one more request each time, no token to keep between them. */
async function call(app: App, path: string, body?: unknown) {
  const { clientId, secret, base } = await settings(app);
  if (!clientId || !secret) throw new Error("fin.payment.paypal: clientId and secret are required");
  const request = (url: string, init: RequestInit) => fetch(url, init).catch((e) => {
    throw new Error(`fin.payment.paypal: unreachable — ${errMsg(e)}`);
  });
  const auth = await request(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  }).then((res) => res.json());
  if (!auth.access_token) throw new Error(`fin.payment.paypal: ${auth.error ?? "no access token"}`);
  const res = await request(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${auth.access_token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fin.payment.paypal: ${json.name ?? res.status} ${json.message ?? ""}`.trim());
  return json;
}

const decimal = (minor: number, currency: string) => {
  const digits = currencies.decimals(currency);
  return (minor / 10 ** digits).toFixed(digits);
};
const minor = (value: unknown, currency: string) =>
  Math.round(Number(value ?? 0) * 10 ** currencies.decimals(currency));
const dataOf = (payment: Row) => JSON.parse(String(payment.data ?? "{}")) ?? {};

/** What a captured order says: paid, what PayPal kept, and the capture to refund. */
// deno-lint-ignore no-explicit-any -- PayPal's order, as it answers
function captured(payment: Row, order: Record<string, any>): State {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) return {};
  const currency = String(payment.currency);
  const breakdown = capture.seller_receivable_breakdown;
  return {
    status: capture.status === "COMPLETED" ? "paid" : capture.status === "PENDING" ? "processing" : "failed",
    paid: minor(capture.amount?.value, currency),
    fee: breakdown?.paypal_fee?.currency_code === currency ? minor(breakdown.paypal_fee.value, currency) : undefined,
    data: { ...dataOf(payment), capture: capture.id },
  };
}

/**
 * PayPal: the payer approves on PayPal, comes back, and the order is captured then. Nothing a
 * return or webhook says is taken over — the order is asked.
 */
export const paymentProvider: Provider = {
  name: "paypal",
  label: "PayPal",

  async methods(app) {
    const { clientId, secret } = await settings(app);
    return clientId && secret ? [{ name: "", label: "PayPal" }] : [];
  },

  async start(app, payment, urls) {
    const currency = String(payment.currency);
    const order = await call(app, "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: String(payment.id),
        custom_id: String(payment.id),
        description: String(payment.description || payment.ref || `Payment ${payment.id}`).slice(0, 127),
        amount: { currency_code: currency, value: decimal(Number(payment.amount), currency) },
      }],
      payment_source: {
        paypal: { experience_context: { return_url: urls.back, cancel_url: urls.back, user_action: "PAY_NOW" } },
      },
    });
    const approve = order.links?.find((link: { rel: string }) => link.rel === "payer-action" || link.rel === "approve");
    return { redirect: approve?.href, externalId: order.id };
  },

  // approved by the payer: captured now. A sync after that reads the capture.
  async sync(app, payment) {
    if (payment.status !== "pending" && payment.status !== "processing") return {};
    const path = `/v2/checkout/orders/${payment.external_id}`;
    const order = await call(app, path);
    if (order.status === "APPROVED") return captured(payment, await call(app, `${path}/capture`, {}));
    if (order.status === "COMPLETED") return captured(payment, order);
    if (order.status === "VOIDED") return { status: "canceled" };
    return {};
  },

  async refund(app, payment, amount) {
    const { capture } = dataOf(payment);
    if (!capture) throw new Error("fin.payment.paypal: no capture to refund");
    const currency = String(payment.currency);
    const value = decimal(amount, currency);
    await call(app, `/v2/payments/captures/${capture}/refund`, { amount: { currency_code: currency, value } });
    return {};
  },

  // a webhook is only a hint: it names the order, which is then asked — no signature to trust
  async webhook(ctx) {
    const event = JSON.parse(await ctx.req.raw.text().catch(() => "") || "{}");
    const resource = event.resource ?? {};
    const order = String(resource.supplementary_data?.related_ids?.order_id ?? resource.id ?? "");
    if (!order) return [];
    const ids = await ctx.app.db.col`SELECT id FROM payment WHERE provider = 'paypal' AND external_id = ${order}`;
    return ids.map(Number);
  },
};
