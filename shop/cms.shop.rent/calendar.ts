import { sql } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { Entry, Source } from "@qino/qino/calendar";

/** Booked rentals only; public availability does not expose the customer's reservation. */
export const calendar: Source = {
  title: { en: "Rentals", de: "Vermietungen" },
  color: "orange",
  async query(ctx, period) {
    if (!ctx.userId) return [];
    const tree = cms(ctx.app);
    const page = await (await tree.nodeByModule("cms.backend.shop.orders"))?.page();
    const access = page ? await page.access() : 0;
    const all = ctx.user?.superuser || access > 1;
    const url = access ? await page!.url() : "";
    const rows = await ctx.app.db.query`
      SELECT r.*, l.order_id FROM shop_rental r
      LEFT JOIN shop_order_line l ON l.id = r.line_id
      WHERE r.begins < ${Temporal.Instant.from(period.end).epochMilliseconds / 1000}
        AND r.ends > ${Temporal.Instant.from(period.start).epochMilliseconds / 1000}
        AND ${all ? sql`${true}` : sql`r.usr_id = ${ctx.userId}`}
      ORDER BY r.begins, r.id`;
    const products = new Map<number, { title: string; url: string }>();
    const result: Entry[] = [];
    for (const row of rows) {
      const id = Number(row.product_id);
      if (!products.has(id)) {
        const node = await tree.node(id);
        products.set(id, { title: (await node.showTitle()).plain(), url: await node.url() });
      }
      const product = products.get(id)!;
      const link = url && row.order_id ? new URL(url, ctx.req.url.href) : undefined;
      link?.searchParams.set("order", String(row.order_id));
      result.push({
        id: String(row.id), title: product.title, url: product.url,
        start: Temporal.Instant.fromEpochMilliseconds(Number(row.begins) * 1000).toString(),
        end: Temporal.Instant.fromEpochMilliseconds(Number(row.ends) * 1000).toString(),
        ...(link && { editUrl: link.href }),
      });
    }
    return result;
  },
};
