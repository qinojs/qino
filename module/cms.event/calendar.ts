import { overlaps } from "@qino/qino/calendar";
import { cms } from "@qino/qino/cms";

import { icalStatus, titled } from "./mod.ts";
import { decodeRow, select } from "./range.ts";

import type { Entry, Source } from "@qino/qino/calendar";

export const calendar: Source = {
  title: { en: "Events", de: "Veranstaltungen" },
  color: "blue",
  async query(ctx, period) {
    const { app } = ctx, tree = cms(app);
    const rows = await app.db.query`${select(period)}`;
    // editors open an event in the backend, where it is edited, if they may open that page
    const backend = await (await tree.nodeByModule("cms.backend.event"))?.page();
    const edit = backend && await backend.access() ? new URL(await backend.url(), ctx.req.url.href) : undefined;
    const events = new Map<number, { title: string; url: string; editUrl?: string; status?: Entry["status"] } | null>();
    const result: Entry[] = [];
    for (const row of rows) {
      const id = Number(row.event_id);
      if (!events.has(id)) {
        const node = await tree.node(id);
        if (edit) edit.searchParams.set("id", String(id));
        events.set(id, node.exists() && await node.isReadable() ? {
          title: (await node.showTitle()).plain(), url: await node.url(), ...(icalStatus(row.status) && { status: icalStatus(row.status) }),
          ...(edit && await node.access() >= 2 && { editUrl: edit.pathname + edit.search }),
        } : null);
      }
      const event = events.get(id);
      if (!event) continue;
      const { name, price: _, ...range } = decodeRow(row);
      const item = { id: String(row.id), ...event, title: titled(event.title, { name }), ...range };
      if (overlaps(item, period, { timeZone: period.timeZone })) result.push(item);
    }
    return result;
  },
};
