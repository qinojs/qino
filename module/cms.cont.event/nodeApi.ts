import { AccessError, ApiError } from "@qino/qino";
import { exact, isDate, toLocal } from "@qino/qino/calendar";
import { add, get, list, remove, set, update, zoneOf } from "@qino/qino/cms.event";

import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

/** An event for its editors: its details (`set`, the zone among them), its dates in local time, a date to save or remove. */
export default async function (node: Node, input: {
  get?: boolean; set?: Record<string, unknown>; save?: Range & { id?: number }; remove?: number;
}) {
  if (await node.access() < 2) throw new AccessError();
  if (input.set) await set(node, input.set);
  const event = await get(node) ?? { id: node.id }, timeZone = await zoneOf(node.app, event);
  if (input.save) {
    const { id } = input.save;
    const range = { start: exact(input.save.start, timeZone), end: exact(input.save.end, timeZone) };
    if (id && !await update(node, Number(id), range)) throw new ApiError(404, "Event date not found");
    return { id: id ? Number(id) : Number(await add(node, range)), ...range };
  }
  if (input.remove) {
    await remove(node, Number(input.remove));
    return { ok: true };
  }
  if (!input.get && !input.set) return null;
  return {
    event, timeZone,
    dates: (await list(node)).map((date) => {
      const allDay = isDate(date.start);
      const local = (value: string) => allDay ? value : toLocal(value, timeZone);
      return { ...date, allDay, localStart: local(date.start), localEnd: local(date.end) };
    }),
  };
}
