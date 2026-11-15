import { $item, AccessError, ApiError } from "@qino/qino";
import { exact, isDate, toLocal } from "@qino/qino/calendar";
import { add, list, remove, update } from "@qino/qino/cms.event";

import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, input: {
  blocks?: boolean; save?: Range & { id?: number; timeZone?: string }; remove?: number;
}) {
  if (await node.access() < 2) throw new AccessError();
  const timeZone = String(node.settings.time_zone() ?? "UTC");
  if (input.blocks) return (await list(node)).map((block) => {
    const allDay = isDate(block.start);
    const local = (value: string) => allDay ? value : toLocal(value, timeZone);
    return { ...block, allDay, localStart: local(block.start), localEnd: local(block.end), timeZone };
  });
  if (input.save) {
    const { id } = input.save, zone = input.save.timeZone || timeZone;
    new Intl.DateTimeFormat(undefined, { timeZone: zone }); // rejects an unknown time zone
    const range = { start: exact(input.save.start, zone), end: exact(input.save.end, zone) };
    if (id && !await update(node, Number(id), range)) throw new ApiError(404, "Event block not found");
    const saved = id ? Number(id) : Number(await add(node, range));
    if (!node.settings.time_zone() && input.save.timeZone) await node.settings[$item].patch({ time_zone: zone });
    return { id: saved, ...range };
  }
  if (input.remove) {
    await remove(node, Number(input.remove));
    return { ok: true };
  }
  return null;
}
