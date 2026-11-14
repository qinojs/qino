import { sql } from "@qino/qino";
import { occurrences } from "@qino/qino/calendar";
import { cms } from "@qino/qino/cms";

import { schedule, within } from "./schedule.ts";

import type { Entry, Source } from "@qino/qino/calendar";

export const calendar: Source = {
  title: { en: "Events", de: "Veranstaltungen" },
  color: "blue",
  async query(ctx, period) {
    const { app } = ctx, tree = cms(app);
    const rows = await app.db.query`
      SELECT * FROM cms_event
      WHERE ${within(period)}
      ORDER BY ${sql.id("start")}, id`;
    const nodes = new Map<number, { title: string; url: string } | null>();
    const result: Entry[] = [];
    for (const row of rows) {
      const id = Number(row.node_id);
      if (!nodes.has(id)) {
        const node = await tree.node(id);
        nodes.set(id, node.exists() && await node.isReadable()
          ? { title: (await node.showTitle()).plain(), url: await node.url() } : null);
      }
      const node = nodes.get(id);
      if (!node) continue;
      const definition = schedule(row), recurring = row.rrule || definition.rdate?.length;
      for (const item of occurrences(definition, period)) {
        result.push({ id: recurring ? `${row.id}:${item.recurrenceId}` : String(row.id), ...node, start: item.start, end: item.end });
      }
    }
    return result;
  },
};
