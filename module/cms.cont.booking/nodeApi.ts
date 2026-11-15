import { AccessError, ApiError } from "@qino/qino";
import { exact, isDate, toLocal } from "@qino/qino/calendar";
import { add, get, list, remove, set, update, zoneOf } from "@qino/qino/cms.event";

import { book, bookings, cancel, slots } from "./mod.ts";
import { lock, readable } from "./access.ts";

import type { Period, Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, input: {
  slots?: Period; book?: Parameters<typeof book>[1]; cancel?: number; bookings?: boolean;
  offers?: boolean; set?: { time_zone: string }; save?: Range & { id?: number }; remove?: number;
}) {
  await readable(node);
  if (input.slots) return slots(node, input.slots);
  if (input.book) return book(node, input.book);
  if (input.cancel) { await cancel(node, Number(input.cancel)); return { ok: true }; }
  if (input.bookings) return bookings(node);
  if (await node.access() < 2) throw new AccessError();
  if (input.set) await set(node, input.set);
  const timeZone = await zoneOf(node.app, await get(node));
  if (input.offers || input.set) return { timeZone, offers: (await list(node)).map((date) =>
    ({ ...date, localStart: toLocal(date.start, timeZone), localEnd: toLocal(date.end, timeZone) })) };
  if (input.save) {
    const { id } = input.save;
    if (isDate(input.save.start) || isDate(input.save.end)) throw new ApiError(400, "Appointments require a start and end time");
    const range = { start: exact(input.save.start, timeZone), end: exact(input.save.end, timeZone) };
    return node.db.transaction(async () => {
      await lock(node);
      if (!id) return { id: Number(await add(node, range)) };
      if (!await update(node, Number(id), range)) throw new ApiError(404, "Appointment not found");
      return { id: Number(id) };
    });
  }
  if (input.remove) return node.db.transaction(async () => {
    await lock(node);
    if (await node.db.one`SELECT id FROM cms_booking WHERE node_id = ${node.id} AND date_id = ${Number(input.remove)} LIMIT 1`)
      throw new ApiError(409, "An offer with bookings cannot be deleted; keep the existing date instead");
    await remove(node, Number(input.remove));
    return { ok: true };
  });
  return null;
}
