import { createHmac } from "node:crypto";
import { errMsg, safeEqual } from "@qino/qino";
import { fromMinor, toMinor } from "@qino/qino/fin";
import { currency as currencies } from "@qino/qino/locale.currency";

import type { App } from "@qino/qino";
import type { Provider, State } from "@qino/qino/fin.payment";

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
async function settings(app: App) {
  const s = app.settings["fin.payment.btcpay"];
  const [url, storeId, apiKey, webhookSecret] = await Promise.all([s.url, s.storeId, s.apiKey, s.webhookSecret])
    .then((values) => values.map((v) => String(v ?? "").trim()));
  return { url: url.replace(/\/+$/, ""), storeId, apiKey, webhookSecret };
}

/** Greenfield API: `path` below the store. */
async function call(app: App, path: string, init: RequestInit = {}) {
  const { url, storeId, apiKey } = await settings(app);
  if (!url || !storeId || !apiKey) throw new Error("fin.payment.btcpay: url, storeId and apiKey are required");
  const res = await fetch(`${url}/api/v1/stores/${encodeURIComponent(storeId)}/${path}`, {
    ...init,
    headers: { authorization: `token ${apiKey}`, "content-type": "application/json", accept: "application/json" },
  }).catch((e) => {
    throw new Error(`fin.payment.btcpay: unreachable — ${errMsg(e)}`);
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fin.payment.btcpay: ${res.status} ${json.message ?? json.code ?? ""}`.trim());
  return json;
}

/** What BTCPay says about an invoice, as a payment's status. */
const STATUS: Record<string, State["status"]> = {
  New: "pending",
  Processing: "processing",
  Settled: "paid",
  Expired: "expired",
  Invalid: "failed",
};

/**
 * BTCPay Server — self-hosted, no middleman: bitcoin on-chain, Lightning, and whatever else the
 * store has enabled. The payer pays on BTCPay's checkout; it notifies by webhook.
 */
export const paymentProvider: Provider = {
  name: "btcpay",
  label: "Bitcoin",

  async methods(app) {
    const { url, storeId, apiKey } = await settings(app);
    return url && storeId && apiKey ? [{ name: "", label: "Bitcoin / Lightning" }] : [];
  },

  async start(app, payment, urls) {
    const currency = String(payment.currency);
    const invoice = await call(app, "invoices", {
      method: "POST",
      body: JSON.stringify({
        amount: fromMinor(Number(payment.amount), currency).toFixed(currencies.decimals(currency)),
        currency,
        metadata: { orderId: String(payment.id), itemDesc: payment.description ?? undefined },
        checkout: { redirectURL: urls.back, redirectAutomatically: true },
      }),
    });
    return { redirect: invoice.checkoutLink, externalId: invoice.id };
  },

  // Expired with money in it (paid in part, or too late) waits for a person: processing
  async sync(app, payment) {
    if (!payment.external_id) return {};
    const invoice = await call(app, `invoices/${encodeURIComponent(String(payment.external_id))}`);
    const paid = toMinor(Number(invoice.paidAmount ?? 0), String(payment.currency));
    const late = invoice.additionalStatus === "PaidPartial" || invoice.additionalStatus === "PaidLate";
    const status = invoice.status === "Expired" && late ? "processing" : STATUS[invoice.status];
    return { status, paid, data: { status: invoice.status, additionalStatus: invoice.additionalStatus } };
  },

  // BTCPay signs with the webhook's secret; only the invoice id is taken from it
  async webhook(ctx) {
    const { webhookSecret } = await settings(ctx.app);
    const body = await ctx.req.raw.text().catch(() => "");
    if (!webhookSecret || !body) return [];
    const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
    if (!safeEqual(ctx.req.header("btcpay-sig"), `sha256=${signature}`)) return [];
    const invoiceId = String(JSON.parse(body)?.invoiceId ?? "");
    const ids = await ctx.app.db.col`SELECT id FROM payment WHERE provider = 'btcpay' AND external_id = ${invoiceId}`;
    return ids.map(Number);
  },
};
