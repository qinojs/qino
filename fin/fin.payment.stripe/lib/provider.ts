import { createHmac } from "node:crypto";
import { errMsg, safeEqual } from "@qino/qino";

import type { App, Row } from "@qino/qino";
import type { Provider, State } from "@qino/qino/fin.payment";

const API = "https://api.stripe.com/v1/";

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
async function settings(app: App) {
  const s = app.settings["fin.payment.stripe"];
  const [secretKey, webhookSecret] = await Promise.all([s.secretKey, s.webhookSecret]);
  return { secretKey: String(secretKey ?? "").trim(), webhookSecret: String(webhookSecret ?? "").trim() };
}

/** Stripe's form encoding: nested keys as `a[b][0][c]`. */
function form(data: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") form(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function call(app: App, path: string, body?: Record<string, unknown>) {
  const { secretKey } = await settings(app);
  if (!secretKey) throw new Error("fin.payment.stripe: secretKey is required");
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...body ? { "content-type": "application/x-www-form-urlencoded" } : {},
    },
    body: body ? form(body) : undefined,
  }).catch((e) => {
    throw new Error(`fin.payment.stripe: unreachable — ${errMsg(e)}`);
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`fin.payment.stripe: ${json.error?.code ?? res.status} ${json.error?.message ?? ""}`.trim());
  }
  return json;
}

const dataOf = (payment: Row) => JSON.parse(String(payment.data ?? "{}")) ?? {};

/**
 * Stripe Checkout: the payer pays on Stripe's page with whatever the Stripe account offers —
 * cards, TWINT, Apple and Google Pay, SEPA … Amounts are minor units, as here.
 */
export const paymentProvider: Provider = {
  name: "stripe",
  label: "Stripe",

  async methods(app) {
    return (await settings(app)).secretKey ? [{ name: "", label: "Card, TWINT, Apple Pay …" }] : [];
  },

  async start(app, payment, urls) {
    const session = await call(app, "checkout/sessions", {
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(payment.currency).toLowerCase(),
          unit_amount: Number(payment.amount),
          product_data: { name: String(payment.description || payment.ref || `Payment ${payment.id}`) },
        },
      }],
      client_reference_id: String(payment.id),
      metadata: { payment: String(payment.id) },
      payment_intent_data: { metadata: { payment: String(payment.id) } },
      success_url: urls.back,
      cancel_url: urls.back,
    });
    return { redirect: session.url, externalId: session.id };
  },

  // the session says whether it is paid; its PaymentIntent's charge what was refunded and kept
  async sync(app, payment) {
    const expand = "expand[]=payment_intent.latest_charge.balance_transaction";
    const session = await call(app, `checkout/sessions/${payment.external_id}?${expand}`);
    const intent = session.payment_intent;
    const charge = intent?.latest_charge;
    const state: State = { data: { ...dataOf(payment), session: session.id, intent: intent?.id ?? null } };
    if (session.status === "expired") return { ...state, status: "expired" };
    if (session.payment_status !== "paid") return state;
    const fee = charge?.balance_transaction?.currency === String(payment.currency).toLowerCase()
      ? Number(charge.balance_transaction.fee) : undefined;
    const refunded = Number(charge?.amount_refunded ?? 0);
    return { ...state, status: "paid", paid: Number(session.amount_total), refunded, fee };
  },

  async refund(app, payment, amount) {
    const { intent } = dataOf(payment);
    if (!intent) throw new Error("fin.payment.stripe: no payment intent to refund");
    await call(app, "refunds", { payment_intent: intent, amount });
    return {};
  },

  // Stripe signs `<timestamp>.<body>`; the event only says which session or intent
  async webhook(ctx) {
    const { webhookSecret } = await settings(ctx.app);
    const body = await ctx.req.raw.text().catch(() => "");
    if (!webhookSecret || !body) return [];
    // `t=…,v1=…,v1=…`: while a secret is rolled, one v1 per secret — any of them will do
    const parts = String(ctx.req.header("stripe-signature") ?? "").split(",").map((part) => part.split("="));
    const t = parts.find(([key]) => key === "t")?.[1];
    const expected = createHmac("sha256", webhookSecret).update(`${t}.${body}`).digest("hex");
    if (!parts.some(([key, value]) => key === "v1" && safeEqual(value, expected))) return [];
    const object = JSON.parse(body)?.data?.object ?? {};
    const id = String(object.metadata?.payment ?? object.client_reference_id ?? "");
    return id && /^\d+$/.test(id) ? [Number(id)] : [];
  },
};
