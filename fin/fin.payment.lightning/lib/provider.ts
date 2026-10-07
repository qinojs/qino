import { errMsg, html, unixTime } from "@qino/qino";
import { qr } from "@qino/qino/fin.payment";
import { currency as currencies } from "@qino/qino/locale.currency";

import type { App } from "@qino/qino";
import type { Provider } from "@qino/qino/fin.payment";

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
async function settings(app: App) {
  const s = app.settings["fin.payment.lightning"];
  const [url, key, expiry] = await Promise.all([s.url, s.invoiceKey, s.expiry]);
  return {
    url: String(url ?? "").trim().replace(/\/+$/, ""),
    key: String(key ?? "").trim(),
    expiry: Number(expiry) || 60,
  };
}

async function call(app: App, path: string, init: RequestInit = {}) {
  const { url, key } = await settings(app);
  if (!url || !key) throw new Error("fin.payment.lightning: url and invoiceKey are required");
  const res = await fetch(`${url}/api/v1/${path}`, {
    ...init,
    headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" },
  }).catch((e) => {
    throw new Error(`fin.payment.lightning: unreachable — ${errMsg(e)}`);
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fin.payment.lightning: ${res.status} ${json.detail ?? ""}`.trim());
  return json;
}

const dataOf = (payment: { data?: unknown }) => JSON.parse(String(payment.data ?? "{}")) ?? {};

/**
 * Lightning through an LNbits wallet — LNbits runs on LND, Core Lightning, Phoenix and others, and
 * turns the price into satoshis when the invoice is made. Paid in seconds, exactly the amount.
 */
export const paymentProvider: Provider = {
  name: "lightning",
  label: "Lightning",
  watch: true,

  async methods(app) {
    const { url, key } = await settings(app);
    return url && key ? [{ name: "", label: "Bitcoin Lightning" }] : [];
  },

  async start(app, payment, urls) {
    const { expiry } = await settings(app);
    const currency = String(payment.currency);
    const invoice = await call(app, "payments", {
      method: "POST",
      body: JSON.stringify({
        out: false,
        amount: Number(payment.amount) / 10 ** currencies.decimals(currency),
        unit: currency,
        memo: String(payment.title ?? `Payment ${payment.id}`),
        expiry: expiry * 60,
        webhook: urls.notify,
      }),
    });
    const bolt11 = String(invoice.bolt11 ?? invoice.payment_request ?? "");
    return {
      redirect: urls.pay,
      externalId: String(invoice.payment_hash),
      data: { bolt11, until: unixTime() + expiry * 60 },
    };
  },

  async sync(app, payment) {
    if (payment.status !== "pending" && payment.status !== "processing") return {};
    const state = await call(app, `payments/${encodeURIComponent(String(payment.external_id))}`);
    if (state.paid) return { status: "paid", paid: Number(payment.amount) };
    return unixTime() > Number(dataOf(payment).until) ? { status: "expired" } : {};
  },

  async slip(_app, payment) {
    const { bolt11 } = dataOf(payment);
    if (!bolt11) return "";
    const uri = `lightning:${bolt11}`;
    return String(html`<div style="max-width:24rem; margin:auto; text-align:center">
      <a href="${uri}">${html.raw(qr(uri.toUpperCase()))}</a>
      <p><b>${payment.title ?? ""}</b>
      <p style="word-break:break-all"><small><code>${bolt11}</code></small>
    </div>`);
  },
};
