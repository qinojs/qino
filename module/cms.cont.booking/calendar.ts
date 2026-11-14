import { sql } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { Entry, Source } from "@qino/qino/calendar";

export const calendar: Source = {
  title: { en: "Appointments", de: "Terminbuchungen" },
  color: "purple",
  async query(ctx, period) {
    const start = Temporal.Instant.from(period.start).toString({ fractionalSecondDigits: 9 });
    const end = Temporal.Instant.from(period.end).toString({ fractionalSecondDigits: 9 });
    const rows = await ctx.app.db.query`SELECT id, node_id, ${sql.id("start")}, ${sql.id("end")}, usr_id FROM cms_booking
      WHERE cancelled = ${false} AND ${sql.id("start")} < ${end} AND ${sql.id("end")} > ${start}
      ORDER BY ${sql.id("start")}, id`;
    const nodes = new Map<number, { title: string; url: string; editor: boolean } | null>();
    const result: Entry[] = [];
    for (const row of rows) {
      const id = Number(row.node_id);
      if (!nodes.has(id)) {
        const node = await cms(ctx.app).node(id);
        nodes.set(id, node.vs.module === "cms.cont.booking" && await node.isReadable()
          ? { title: (await node.showTitle()).plain(), url: await node.url(), editor: await node.access() >= 2 } : null);
      }
      const node = nodes.get(id);
      if (!node || !node.editor && !(ctx.userId && Number(row.usr_id) === ctx.userId)) continue;
      result.push({ id: String(row.id), title: node.title, url: node.url, start: String(row.start), end: String(row.end) });
    }
    return result;
  },
};
