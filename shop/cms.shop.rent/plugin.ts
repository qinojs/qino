import { unixTime } from "@qino/qino";
import { listen, shopT } from "@qino/qino/cms.shop";

import { factorAt, free, moments, rules, step } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Line, Order, Solution } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

import type { Range } from "./mod.ts";

// This module's column on the product row; the accessor comes from the table.
declare module "@qino/qino/cms.shop" {
  interface Product { rent_interval: string | null; rent_capacity: number }
}

/** Intervals a line rents at most: more is no booking, and the price would loop over them. */
const MAX = 10_000;

/** The times a line's data asks for; none: no rental. Empty when they are no times: not whole
 *  seconds, not forwards, or more than MAX intervals of `seconds`. */
function rangesOf(data: unknown, seconds: number): Range[] | undefined {
  const ranges = (data as { rent?: unknown } | null)?.rent;
  if (ranges === undefined) return;
  if (!Array.isArray(ranges)) return [];
  let steps = 0;
  for (const { begin, end } of ranges.map((r) => r ?? {})) {
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || end <= begin) return [];
    if ((steps += Math.ceil((end - begin) / seconds)) > MAX) return [];
  }
  return ranges;
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  const on = listen(app, signal);

  // the unit price: what the intervals cost on average, each by the rules for its moment
  on("shop:price-initial", async (e) => {
    const seconds = step(e.product), ranges = rangesOf(e.data, seconds);
    if (!ranges?.length) return;
    const all = await rules(app, e.product.$id);
    let total = 0, count = 0;
    for (const range of ranges) {
      // closed moments are the line check's: here they cost the price
      for (const moment of moments(range, seconds)) total += e.price * (factorAt(all, moment) ?? 1), count++;
    }
    if (count) e.price = total / count;
  });

  // the amount is the number of intervals, whatever was asked
  on("shop:line-quantity", async (e: { line: Line; quantity: number }) => {
    const seconds = step(await e.line.product()), ranges = rangesOf(e.line.dataOf(), seconds);
    if (!ranges) return;
    e.quantity = ranges.reduce((sum, { begin, end }) => sum + Math.ceil((end - begin) / seconds), 0);
  });

  on("shop:line-check", async ({ line, errors, solutions }: { line: Line; errors: Record<string, string>; solutions: Record<string, Solution> }) => {
    const product = await line.product(), seconds = step(product), ranges = rangesOf(line.dataOf(), seconds);
    if (!ranges) return;
    const all = await rules(app, line.product_id), now = unixTime();
    // what the lines before it in the order take counts too: the first in the cart gets it
    const lines = (await (await line.order())?.lines() ?? []).filter((l) => String(l.product_id) === String(line.product_id));
    const at = lines.findIndex((l) => l.$id === line.$id);
    const before = (at < 0 ? lines : lines.slice(0, at))
      .flatMap((l) => rangesOf(l.dataOf(), seconds) ?? []).map((r) => ({ begins: r.begin, ends: r.end }));
    // the same time twice in a line is two of the product; a time begun is gone
    const kept: Range[] = [], asked = Map.groupBy(ranges, (r) => `${r.begin}-${r.end}`);
    for (const same of asked.values()) {
      const range = same[0];
      const open = range.begin >= now && [...moments(range, seconds)].every((moment) => factorAt(all, moment) != null);
      kept.push(...same.slice(0, open ? await free(app, line.product_id, range, before) : 0));
    }
    if (kept.length === ranges.length) return;
    errors["rent taken"] = await t`Not available at this time`;
    solutions["drop taken"] = {
      label: await t`Remove the times not available`,
      solve: async () => {
        if (!kept.length) return (await line.order())?.remove(line);
        await line.setData({ ...line.dataOf() as object, rent: kept });
        await line.setQuantity(0); // the times say how many
      },
    };
  });

  on("shop:line-description", async (e: { line: Line; description: string }) => {
    const ranges = rangesOf(e.line.dataOf(), step(await e.line.product()));
    if (!ranges) return;
    const lang = (await e.line.order())?.lang || app.languages.def;
    const day = new Intl.DateTimeFormat(lang, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    const hour = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
    const parts = ranges.map(({ begin, end }) => {
      const from = new Date(begin * 1000), to = new Date(end * 1000);
      return `${day.format(from)} ${hour.format(from)}–${day.format(from) === day.format(to) ? "" : day.format(to) + " "}${hour.format(to)}`;
    });
    e.description = [e.description, ...parts].filter(Boolean).join("\n");
  });

  // from now on the times are taken
  on("shop:ordered", async ({ order }: { order: Order }) => {
    const name = order.party("bill")?.name ?? "";
    for (const line of await order.lines()) {
      for (const { begin, end } of rangesOf(line.dataOf(), step(await line.product())) ?? []) {
        await app.db.table("shop_rental").insert({ product_id: line.product_id, line_id: line.$id, usr_id: order.usr_id, name, begins: begin, ends: end });
      }
    }
  });

  // a canceled order gives its times back
  on("shop:status", async ({ order }: { order: Order }) => {
    if (order.status !== "canceled") return;
    for (const line of await order.lines()) await app.db.exec`DELETE FROM shop_rental WHERE line_id = ${line.$id}`;
  });
}
