import { unixTime } from "@qino/qino";

import { urls } from "./lib/url.ts";

import type { App, Row } from "@qino/qino";

/** `paid` and `refunded` are where money moved; `failed`, `canceled` and `expired` end it unmoved. */
type Status = "pending" | "processing" | "paid" | "failed" | "canceled" | "expired" | "refunded";

/** What a payment is about, so a provider can tell which methods fit. Amounts in minor units. */
type Offer = { amount: number; currency: string; country?: string };

/** A way to pay as a provider offers it; `name` is unique within the provider. */
type Method = { name: string; label: string };

/** What a provider reports. Left-out fields stay as they are; `data` is the provider's own state. */
export type State = {
  status?: Status;
  method?: string;
  paid?: number;
  refunded?: number;
  fee?: number;
  externalId?: string;
  data?: Record<string, unknown>;
};

/**
 * A provider, declared by a module as `export const paymentProvider`.
 *
 * `name` is stored in the `provider` column (survives module renames). `sync` is the only source
 * of truth: the payer's return and the provider's notification merely trigger it, so nothing a
 * browser or webhook sends is trusted.
 */
export type Provider = {
  name: string;
  label: string;
  /** The methods that fit; none, and the provider is not offered. */
  methods(app: App, offer: Offer): Method[] | Promise<Method[]>;
  /** Start an incoming payment; returns where to send the payer. `back` is for the payer,
   *  `notify` for the provider's server. */
  start(app: App, payment: Row, urls: { back: string; notify: string }): Promise<State & { redirect: string }>;
  /** Ask the provider how the payment stands. */
  sync(app: App, payment: Row): Promise<State>;
  /** Pay `amount` back; the refunded total and the status follow from it. */
  refund?(app: App, payment: Row, amount: number): Promise<State>;
};

const providers = (app: App): Provider[] =>
  app.modules.linked().filter((mod) => mod.plugin.paymentProvider).map((mod) => mod.plugin.paymentProvider as Provider);

const provider = (app: App, name: string): Provider | undefined => providers(app).find((p) => p.name === name);

/** Every method that fits the offer, as `provider.method` — what `create()` takes. */
export async function methods(app: App, offer: Offer): Promise<{ method: string; label: string }[]> {
  const offered = await Promise.all(providers(app).map(async (p) =>
    (await p.methods(app, offer)).map(({ name, label }) => ({ method: name ? `${p.name}.${name}` : p.name, label }))));
  return offered.flat();
}

/** What every payment has. `ref` is the consumer's: `<module>:<id>`, found again in `payment:status`. */
type Base = { amount: number; currency: string; ref?: string; title?: string; usrId?: number };

/**
 * Start an incoming payment and get the address to send the payer to. `method` is
 * `provider.method` as `methods()` lists it, or just `provider` to let the payer choose there.
 * `return` is where the payer lands afterwards, paid or not.
 */
export async function create(
  app: App,
  opt: Base & { method: string; return: string },
): Promise<{ id: number; redirect: string }> {
  const [name, method] = opt.method.split(/\.(.*)/);
  const selected = provider(app, name);
  if (!selected) throw new Error(`payment provider not available: ${name}`);
  const id = await insert(app, opt, {
    direction: "in",
    provider: name,
    method: method || null,
    status: "pending",
    return_url: new URL(opt.return, await app.url()).href,
  });
  const payment = (await get(app, id))!;
  const started = await selected.start(app, payment, await urls(app, id)).catch(async (e) => {
    await apply(app, payment, { status: "failed", data: { error: String(e?.message ?? e) } });
    throw e;
  });
  const { redirect, ...state } = started;
  await apply(app, payment, state);
  return { id, redirect };
}

/**
 * Record a payment that happened without a provider flow: cash, a bank transfer assigned by hand.
 * `provider` names the source. Paid in full unless `paid` says otherwise.
 */
export async function record(
  app: App,
  opt: Base & { direction: "in" | "out"; provider: string; method?: string; paid?: number },
): Promise<number> {
  const paid = opt.paid ?? opt.amount;
  if (!Number.isSafeInteger(paid) || paid < 0) throw new Error("paid must be an integer in minor units");
  const id = await insert(app, opt, {
    direction: opt.direction,
    provider: opt.provider,
    method: opt.method ?? null,
    status: "paid",
    paid,
  });
  await app.fire("payment:status", { payment: await get(app, id) });
  return id;
}

/** Ask the provider and store what it says. Safe to call any time, as often as needed; a payment
 *  without a linked provider (recorded, or its module gone) stays as it is. */
export async function sync(app: App, id: number): Promise<Row | undefined> {
  const payment = await get(app, id);
  const selected = payment && provider(app, String(payment.provider));
  if (!selected) return payment;
  return apply(app, payment, await selected.sync(app, payment));
}

/** Pay back, by default all that is left. */
export async function refund(app: App, id: number, amount?: number): Promise<Row | undefined> {
  const payment = await get(app, id);
  if (!payment) return;
  const left = Number(payment.paid) - Number(payment.refunded);
  amount ??= left;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > left) {
    throw new Error("nothing to refund, or more than was paid");
  }
  const refunder = provider(app, String(payment.provider))?.refund;
  if (!refunder) throw new Error(`${payment.provider} cannot refund`);
  const refunded = Number(payment.refunded) + amount;
  const status = refunded >= Number(payment.paid) ? "refunded" : undefined;
  return apply(app, payment, { refunded, status, ...await refunder(app, payment, amount) });
}

const get = (app: App, id: number): Promise<Row | undefined> => app.db.row`SELECT * FROM payment WHERE id = ${id}`;

async function insert(app: App, opt: Base, values: Record<string, unknown>): Promise<number> {
  if (!Number.isSafeInteger(opt.amount) || opt.amount <= 0) {
    throw new Error("amount must be a positive integer in minor units");
  }
  if (!/^[A-Z]{3}$/.test(opt.currency)) throw new Error("currency must be an ISO 4217 code");
  const time = unixTime();
  return Number(await app.db.table("payment").insert({
    ...values,
    amount: opt.amount,
    currency: opt.currency,
    ref: opt.ref ?? null,
    title: opt.title?.slice(0, 191) ?? null,
    usr_id: opt.usrId ?? null,
    created: time,
    changed: time,
  }));
}

/**
 * Store a state. The update is conditional on the status read before, so of two concurrent
 * reports (return and notification) only one fires `payment:status`.
 */
async function apply(app: App, payment: Row, state: State): Promise<Row | undefined> {
  const status = state.status ?? payment.status;
  const changed = await app.db.exec`
    UPDATE payment SET
      status = ${status},
      method = ${state.method ?? payment.method},
      paid = ${state.paid ?? payment.paid},
      refunded = ${state.refunded ?? payment.refunded},
      fee = ${state.fee ?? payment.fee},
      external_id = ${state.externalId ?? payment.external_id},
      data = ${state.data ? JSON.stringify(state.data) : payment.data},
      changed = ${unixTime()}
    WHERE id = ${payment.id} AND status = ${payment.status}`;
  const fresh = await get(app, Number(payment.id));
  if (changed.affectedRows && status !== payment.status) {
    await app.fire("payment:status", { payment: fresh, previous: payment.status });
  }
  return fresh;
}
