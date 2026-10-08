import { errMsg, html, unixTime } from "@qino/qino";
import { qr } from "@qino/qino/fin.payment";
import { currency as currencies } from "@qino/qino/locale.currency";

import { address } from "./address.ts";

import type { App, Row } from "@qino/qino";
import type { Provider, State } from "@qino/qino/fin.payment";

const SATS = 100_000_000;

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
async function settings(app: App) {
  const s = app.settings["fin.payment.bitcoin"];
  const [key, esplora, window, confirmations] = await Promise.all([s.xpub, s.esplora, s.window, s.confirmations]);
  return {
    key: String(key ?? "").trim(),
    esplora: (String(esplora ?? "").trim() || "https://mempool.space/api").replace(/\/+$/, ""),
    window: Number(window) || 30,
    confirmations: Number(confirmations) || 1,
  };
}

async function get(url: string) {
  const res = await fetch(url).catch((e) => {
    throw new Error(`fin.payment.bitcoin: unreachable — ${errMsg(e)}`);
  });
  if (!res.ok) throw new Error(`fin.payment.bitcoin: ${res.status} from ${new URL(url).host}`);
  return res.json();
}

const dataOf = (payment: Row) => JSON.parse(String(payment.data ?? "{}")) ?? {};

/** What arrived at an address, in satoshis: all of it, and what is confirmed deep enough. */
async function received(esplora: string, to: string, confirmations: number) {
  const [txs, tip] = await Promise.all([get(`${esplora}/address/${to}/txs`), get(`${esplora}/blocks/tip/height`)]);
  let seen = 0, confirmed = 0;
  type Tx = {
    status: { confirmed: boolean; block_height?: number };
    vout: { scriptpubkey_address?: string; value: number }[];
  };
  for (const tx of txs as Tx[]) {
    const value = tx.vout.filter((out) => out.scriptpubkey_address === to).reduce((sum, out) => sum + out.value, 0);
    seen += value;
    if (tx.status.confirmed && Number(tip) - Number(tx.status.block_height) + 1 >= confirmations) confirmed += value;
  }
  return { seen, confirmed };
}

/**
 * Bitcoin on-chain, without anyone in between: each payment gets an address of its own from the
 * wallet's public key, the price is fixed in bitcoin for a while, and the chain is read from an
 * Esplora server (mempool.space, or your own).
 */
export const paymentProvider: Provider = {
  name: "bitcoin",
  label: "Bitcoin",
  watch: true,

  async methods(app, { currency }) {
    const { key, esplora } = await settings(app);
    if (!key) return [];
    const prices = await get(`${esplora}/v1/prices`).catch(() => ({}));
    return Number(prices[currency]) > 0 ? [{ name: "", label: "Bitcoin" }] : [];
  },

  async start(app, payment, urls) {
    const { key, esplora, window } = await settings(app);
    const currency = String(payment.currency);
    const price = Number((await get(`${esplora}/v1/prices`))[currency]);
    if (!(price > 0)) throw new Error(`fin.payment.bitcoin: no bitcoin price in ${currency}`);
    const sats = Math.ceil(Number(payment.amount) / 10 ** currencies.decimals(currency) / price * SATS);
    const to = address(key, Number(payment.id));
    return { redirect: urls.pay, externalId: to, data: { address: to, sats, price, until: unixTime() + window * 60 } };
  },

  // seen but not confirmed: processing; confirmed in full: paid. What counts is what arrived,
  // in the payment's currency at the price it was asked for.
  async sync(app, payment) {
    if (payment.status !== "pending" && payment.status !== "processing") return {};
    const { esplora, confirmations } = await settings(app);
    const data = dataOf(payment);
    const { seen, confirmed } = await received(esplora, data.address, confirmations);
    const paid = Math.round(Number(payment.amount) * confirmed / data.sats);
    const state: State = { paid, data: { ...data, seen, confirmed } };
    if (confirmed >= data.sats) return { ...state, status: "paid" };
    if (seen) return { ...state, status: "processing" };
    return unixTime() > Number(data.until) ? { status: "expired" } : {};
  },

  async slip(_app, payment) {
    const { address: to, sats, until } = dataOf(payment);
    if (!to) return "";
    const btc = (Math.max(0, sats - Number(dataOf(payment).confirmed ?? 0)) / SATS).toFixed(8);
    const uri = `bitcoin:${to}?amount=${btc}`;
    return String(html`<div style="max-width:24rem; margin:auto; text-align:center">
      <a href="${uri}">${html.raw(qr(uri))}</a>
      <p><b>${btc} BTC</b> ${payment.description ? html`· ${payment.description}` : ""}
      <p style="word-break:break-all"><code>${to}</code>
      <p><small>${new Date(Number(until) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC</small>
    </div>`);
  },
};
