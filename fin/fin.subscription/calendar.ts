import { sql } from "@qino/qino";
import { dateRange } from "@qino/qino/calendar";

import type { Entry, Source } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

/** Subscription period starts, anchored to the original day even in short months. */
export const calendar: Source = {
  title: { en: "Subscriptions", de: "Abonnements" },
  color: "green",
  async query(ctx, period) {
    if (!ctx.userId) return [];
    const host = ctx.state.cms?.mainNode as Node | undefined;
    const page = await (await host?.cms.nodeByModule("cms.backend.fin.subscription"))?.page();
    const access = page ? await page.access() : 0;
    const all = ctx.user?.superuser || access > 1;
    const url = access ? await page!.url() : "";
    const days = dateRange(period);
    const rows = await ctx.app.db.query`
      SELECT s.id, s.name, s.start_date, s.end_date, p.name AS plan_name,
        COALESCE(s.interval_unit, p.interval_unit, ${"year"}) AS unit,
        COALESCE(s.interval_count, p.interval_count, ${1}) AS count
      FROM subscription s LEFT JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.start_date < ${days.end} AND (s.end_date IS NULL OR s.end_date > ${days.start})
        AND ${all ? sql`${true}` : sql`s.usr_id = ${ctx.userId}`}`;
    const result: Entry[] = [], from = Temporal.PlainDate.from(days.start);
    for (const row of rows) {
      const anchor = Temporal.PlainDate.from(String(row.start_date).slice(0, 10));
      const months = Number(row.count) * (row.unit === "month" ? 1 : 12);
      if (!Number.isSafeInteger(months) || months < 1) throw new RangeError("Invalid subscription interval");
      let index = Math.max(0, Math.floor(((from.year - anchor.year) * 12 + from.month - anchor.month) / months));
      const title = [row.plan_name, row.name].filter(Boolean).join(" · ");
      for (let date = anchor.add({ months: index * months }); date.toString() < days.end; date = anchor.add({ months: ++index * months })) {
        const start = date.toString();
        if (row.end_date && start >= String(row.end_date).slice(0, 10)) break;
        if (start < days.start) continue;
        const link = url ? new URL(url, ctx.req.url.href) : undefined;
        link?.searchParams.set("subscription", String(row.id));
        result.push({ id: `${row.id}:${start}`, title, start, end: date.add({ days: 1 }).toString(), ...(link && { editUrl: link.href }) });
      }
    }
    return result;
  },
};
