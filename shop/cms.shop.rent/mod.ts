import { timeSelector } from "./pub/selector.js";

import type { App, Row } from "@qino/qino";

export { timeSelector };

/** A time a product is rented for, unix time. */
export type Range = { begin: number; end: number };

type Matches = (date: Date) => boolean;
/** When a product can be rented and at what factor of its price. */
export type Rules = { closed: Matches[]; factors: [Matches, number][] };

const SECONDS: Record<string, number> = { minute: 60, hour: 3600, day: 86400, week: 604800 };

/** What is rented at a time, in seconds: "1 hour" is 3600. */
export function step(product?: { rent_interval?: unknown }): number {
  const [, n, unit] = /(\d+)\s*(minute|hour|day|week)/.exec(String(product?.rent_interval ?? "")) ?? [];
  return Number(n) * SECONDS[unit] || 3600;
}

/** The product's rules from shop_rent_price: a factor, or none for closed. */
export async function rules(app: App, product: unknown): Promise<Rules> {
  const rows = await app.db.query`SELECT selector, multiplier FROM shop_rent_price WHERE product_id = ${product} ORDER BY id`;
  return {
    closed: rows.filter((r) => r.multiplier == null).map((r) => timeSelector(String(r.selector))),
    factors: rows.filter((r) => r.multiplier != null).map((r) => [timeSelector(String(r.selector)), Number(r.multiplier)]),
  };
}

/** The intervals of a range, by their start. */
export function* moments({ begin, end }: Range, seconds: number): Generator<Date> {
  for (let time = Number(begin); time < Number(end); time += seconds) yield new Date(time * 1000);
}

/** What a moment costs in factors of the price; null when closed. */
export const factorAt = ({ closed, factors }: Rules, moment: Date): number | null =>
  closed.some((matches) => matches(moment)) ? null : factors.reduce((f, [matches, m]) => matches(moment) ? f * m : f, 1);

/** How many rentals run at once at most within the range. */
export function busy(rentals: Row[], { begin, end }: Range): number {
  const edges = rentals.flatMap((r) => Number(r.begins) < end && Number(r.ends) > begin
    ? [[Math.max(Number(r.begins), begin), 1], [Number(r.ends), -1]] : [])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0, most = 0;
  for (const [, step] of edges) most = Math.max(most, now += step);
  return most;
}

/** The rentals of a product that touch the range. */
export const rentals = (app: App, product: unknown, { begin, end }: Range): Promise<Row[]> =>
  app.db.query`SELECT begins, ends FROM shop_rental WHERE product_id = ${product} AND begins < ${end} AND ends > ${begin}`;

/** How many of the product are still free for all of the range: its capacity less what is booked,
 *  and less `also` (times not booked yet, in rental shape: begins, ends). */
export async function free(app: App, product: unknown, range: Range, also: Row[] = []): Promise<number> {
  const capacity = Number(await app.db.one`SELECT rent_capacity FROM shop_product WHERE id = ${product}` ?? 1) || 1;
  return Math.max(0, capacity - busy([...await rentals(app, product, range), ...also], range));
}
