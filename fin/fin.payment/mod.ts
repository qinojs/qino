import { unixTime } from "@qino/qino";
import qrcode from "nayuki-qr-code-generator";

import { urls } from "./lib/url.ts";

import type { App, Ctx, Row } from "@qino/qino";

// deno-lint-ignore no-explicit-any -- the package has no types
const { QrCode } = qrcode as any;

/** `paid` and `refunded` are where money moved; `failed`, `canceled` and `expired` end it unmoved. */
type Status = "pending" | "processing" | "paid" | "failed" | "canceled" | "expired" | "refunded";

/** What a payment would be: providers offer what fits. `usrId`: whose — credit is theirs. */
type Offer = { amount: number; currency: string; country?: string; usrId?: number };

/** A way to pay as a provider offers it; `name` is unique within the provider. */
type Method = { name: string; label: string };

/** Where the payer and the provider's server come back: see `lib/url.ts`. */
type Urls = { back: string; notify: string; pay: string };

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
   *  `notify` for the provider's server, `pay` shows the slip. */
  start(app: App, payment: Row, urls: Urls): Promise<State & { redirect: string }>;
  /** Ask the provider how the payment stands. */
  sync(app: App, payment: Row): Promise<State>;
  /** Pay `amount` back; the refunded total and the status follow from it. */
  refund?(app: App, payment: Row, amount: number): Promise<State>;
  /** What the payer needs to pay outside a provider's page — a QR bill, an address with its QR
   *  code — as HTML. Shown at `pay`, appended to an invoice. */
  slip?(app: App, payment: Row): Promise<string>;
  /** The slip is paid within minutes (crypto): its page asks again every few seconds and moves
   *  on to `return` once paid. */
  watch?: boolean;
  /** A notification for all payments at `payment/webhook/<name>`: verify it, and answer which
   *  payments it is about — they are synced, nothing it says is taken over. */
  webhook?(ctx: Ctx): Promise<number[]>;
};

const providers = (app: App): Provider[] =>
  app.modules.linked().filter((mod) => mod.plugin.paymentProvider).map((mod) => mod.plugin.paymentProvider as Provider);

/** The linked provider of that name. */
export const provider = (app: App, name: string): Provider | undefined => providers(app).find((p) => p.name === name);

/** Every method that fits the offer, as `provider.method` — what `create()` takes. */
export async function methods(app: App, offer: Offer): Promise<{ method: string; label: string }[]> {
  const offered = await Promise.all(providers(app).map(async (p) =>
    (await p.methods(app, offer)).map(({ name, label }) => ({ method: name ? `${p.name}.${name}` : p.name, label }))));
  return offered.flat();
}

/** The `ref` of what follows from a payment elsewhere: a move on a user's credit, an entry. */
export const refOf = (id: number): string => `fin.payment:${id}`;

/** What every payment has. `ref` is the consumer's: `<module>:<id>`, found again in `payment:change`. */
type Base = { amount: number; currency: string; ref?: string; description?: string; usrId?: number; payer?: Payer };

/** Who pays, as an invoice names its party: a slip prints it. */
export type Payer = { name: string; address?: Record<string, string> };

/**
 * Start an incoming payment and get the address to send the payer to. `method` is
 * `provider.method` as `methods()` lists it, or just `provider` to let the payer choose there.
 * `return` is where the payer lands afterwards, paid or not. A payment with a slip still waiting
 * for the same `ref` and method is that one: an invoice has one QR bill, not one per ask.
 */
export async function create(
  app: App,
  opt: Base & { method: string; return: string },
): Promise<{ id: number; redirect: string }> {
  const [name, method] = opt.method.split(/\.(.*)/);
  const selected = provider(app, name);
  if (!selected) throw new Error(`payment provider not available: ${name}`);
  const waiting = selected.slip && opt.ref ? await app.db.one`SELECT id FROM payment
    WHERE ref = ${opt.ref} AND provider = ${name} AND COALESCE(method, '') = ${method ?? ""}
      AND status IN ('pending', 'processing') ORDER BY id DESC` : undefined;
  if (waiting != null) return { id: Number(waiting), redirect: (await urls(app, Number(waiting))).pay };
  const id = await insert(app, opt, {
    direction: "in",
    provider: name,
    method: method || null,
    status: "pending",
    return_url: new URL(opt.return, await app.url()).href,
  });
  const payment = (await get(app, id))!;
  const { redirect, ...state } = await selected.start(app, payment, await urls(app, id)).catch(async (e) => {
    await apply(app, payment, { status: "failed", data: { error: String(e?.message ?? e) } });
    throw e;
  });
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
  await app.fire("payment:change", { payment: await get(app, id) });
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

/** Withdraw a payment nobody has started paying (`pending`): what it asked for is no longer owed.
 *  Anything further along is left as it is. */
export async function cancel(app: App, id: number): Promise<Row | undefined> {
  const payment = await get(app, id);
  if (payment?.status !== "pending") return payment;
  return apply(app, payment, { status: "canceled" });
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

/** The slip of an open payment, as HTML; nothing if it is settled or its provider has none. */
export async function slip(app: App, id: number): Promise<string | undefined> {
  const payment = await get(app, id);
  if (!payment || (payment.status !== "pending" && payment.status !== "processing")) return;
  return provider(app, String(payment.provider))?.slip?.(app, payment);
}

/**
 * The slip a payment by `method` would have — for a preview, before there is a payment. Only
 * where the provider can draw one without starting (a QR bill); nothing otherwise.
 */
export async function sample(
  app: App,
  method: string,
  offer: { amount: number; currency: string; description?: string; payer?: Payer },
): Promise<string | undefined> {
  const [name, kind] = method.split(/\.(.*)/);
  const payment = {
    id: 0, provider: name, method: kind || null, status: "pending", paid: 0, refunded: 0,
    amount: offer.amount, currency: offer.currency, description: offer.description ?? null, external_id: null, data: null,
    payer: offer.payer ? JSON.stringify(offer.payer) : null,
  } as Row;
  return await provider(app, name)?.slip?.(app, payment).catch(() => undefined) || undefined;
}

/** A QR code as SVG, for slips: the same encoder u2's <u2-qrcode> uses in the browser. */
export function qr(text: string): string {
  const code = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  const border = 4;
  const size = code.size + border * 2;
  let path = "";
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) if (code.getModule(x, y)) path += `M${x + border},${y + border}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="100%" height="100%" fill="#fff"/><path d="${path}"/></svg>`;
}

const get = (app: App, id: number): Promise<Row | undefined> => app.db.row`SELECT * FROM payment WHERE id = ${id}`;

async function insert(app: App, opt: Base, values: Record<string, unknown>) {
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
    description: opt.description?.slice(0, 191) ?? null,
    usr_id: opt.usrId ?? null,
    payer: opt.payer ? JSON.stringify(opt.payer) : null,
    created: time,
    changed: time,
  }));
}

/**
 * Store a state. The update is conditional on what was read before, so of two concurrent reports
 * (return and notification) only one fires `payment:change` — for a new status, or money that
 * moved (a second partial transfer leaves the status as it was).
 */
async function apply(app: App, payment: Row, state: State): Promise<Row | undefined> {
  const status = state.status ?? payment.status;
  const paid = state.paid ?? payment.paid;
  const refunded = state.refunded ?? payment.refunded;
  const changed = await app.db.exec`
    UPDATE payment SET
      status = ${status},
      method = ${state.method ?? payment.method},
      paid = ${paid},
      refunded = ${refunded},
      fee = ${state.fee ?? payment.fee},
      external_id = ${state.externalId ?? payment.external_id},
      data = ${state.data ? JSON.stringify(state.data) : payment.data},
      changed = ${unixTime()}
    WHERE id = ${payment.id}
      AND status = ${payment.status} AND paid = ${payment.paid} AND refunded = ${payment.refunded}`;
  const fresh = await get(app, Number(payment.id));
  const moved = status !== payment.status || Number(paid) !== Number(payment.paid)
    || Number(refunded) !== Number(payment.refunded);
  if (changed.affectedRows && moved) await app.fire("payment:change", { payment: fresh, previous: payment.status });
  return fresh;
}
