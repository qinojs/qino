import { AccessError, ApiError } from "@qino/qino";
import { add, list, remove, update } from "@qino/qino/cms.event";

import { book, bookings, cancel, slots } from "./mod.ts";
import { lock, readable } from "./access.ts";

import type { Period, Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, input: {
  slots?: Period; book?: Parameters<typeof book>[1]; cancel?: number; bookings?: boolean;
  offers?: boolean; save?: Range & { id?: number; timeZone?: string }; remove?: number;
}) {
  await readable(node);
  if (input.slots) return slots(node, input.slots);
  if (input.book) return book(node, input.book);
  if (input.cancel) { await cancel(node, Number(input.cancel)); return { ok: true }; }
  if (input.bookings) return bookings(node);
  if (await node.access() < 2) throw new AccessError();
  if (input.offers) return (await list(node)).map((event) => {
    const zone = String(node.settings.time_zone() ?? "UTC");
    const local = (value: string) => Temporal.Instant.from(value).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: "minute" });
    return { ...event, localStart: local(event.start), localEnd: local(event.end), timeZone: zone };
  });
  if (input.save) {
    if (!/[Tt ]/.test(input.save.start) || !/[Tt ]/.test(input.save.end)) throw new ApiError(400, "Appointments require a start and end time");
    const range = { ...input.save };
    const zone = range.timeZone || String(node.settings.time_zone() ?? "UTC");
    const instant = (value: string) => /(?:Z|[+-]\d\d:\d\d|\])$/i.test(value) ? value
      : Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString();
    range.start = instant(range.start);
    range.end = instant(range.end);
    range.timeZone = zone;
    return node.db.transaction(async () => {
      await lock(node);
      if (!range.id) return { id: Number(await add(node, range)) };
      if (!await update(node, Number(range.id), range)) throw new ApiError(404, "Appointment not found");
      return { id: Number(range.id) };
    });
  }
  if (input.remove) return node.db.transaction(async () => {
    await lock(node);
    if (await node.db.one`SELECT id FROM cms_booking WHERE node_id = ${node.id} AND event_id = ${Number(input.remove)} LIMIT 1`)
      throw new ApiError(409, "An offer with bookings cannot be deleted; keep the existing block instead");
    await remove(node, Number(input.remove));
    return { ok: true };
  });
  return null;
}
