import { $item, AccessError, ApiError } from "@qino/qino";
import { exact, isDate, toLocal } from "@qino/qino/calendar";
import { add, list, remove, update, zoneOf } from "@qino/qino/cms.event";

import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

/** The dates of any node, for its editors: read, save, remove, and the zone their local times are in. */
export default async function (node: Node, input: {
  blocks?: boolean; save?: Range & { id?: number }; remove?: number; zone?: string;
}) {
  if (await node.access() < 2) throw new AccessError();
  if (input.zone !== undefined) {
    // empty: back to the default of cms.event
    if (input.zone) new Intl.DateTimeFormat(undefined, { timeZone: input.zone }); // rejects an unknown time zone
    await node.settings[$item].patch({ time_zone: input.zone || null });
    return { timeZone: await zoneOf(node) };
  }
  const timeZone = await zoneOf(node);
  if (input.blocks) return {
    timeZone,
    blocks: (await list(node)).map((block) => {
      const allDay = isDate(block.start);
      const local = (value: string) => allDay ? value : toLocal(value, timeZone);
      return { ...block, allDay, localStart: local(block.start), localEnd: local(block.end) };
    }),
  };
  if (input.save) {
    const { id } = input.save;
    const range = { start: exact(input.save.start, timeZone), end: exact(input.save.end, timeZone) };
    if (id && !await update(node, Number(id), range)) throw new ApiError(404, "Event block not found");
    return { id: id ? Number(id) : Number(await add(node, range)), ...range };
  }
  if (input.remove) {
    await remove(node, Number(input.remove));
    return { ok: true };
  }
  return null;
}
