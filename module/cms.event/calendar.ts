import { overlaps } from "@qino/qino/calendar";
import { cms } from "@qino/qino/cms";

import { decode, select } from "./range.ts";

import type { Entry, Source } from "@qino/qino/calendar";

export const calendar: Source = {
  title: { en: "Events", de: "Veranstaltungen" },
  color: "blue",
  async query(ctx, period) {
    const { app } = ctx, tree = cms(app);
    const rows = await app.db.query`${select(period)}`;
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
      const item = { id: String(row.id), ...node, ...decode(row) };
      if (overlaps(item, period, { timeZone: period.timeZone })) result.push(item);
    }
    return result;
  },
};
