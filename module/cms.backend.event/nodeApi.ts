import { AccessError, ApiError, getCtx } from "@qino/qino";
import { ADMIN } from "@qino/qino/cms";
import { edit } from "@qino/qino/cms.cont.event";
import { get } from "@qino/qino/cms.event";

import type { Node } from "@qino/qino/cms";

const EVENT = "cms.cont.event", CATEGORY = "cms.cont.event.category";

export default async function (node: Node, input: {
  create?: { parent: number; title: string };
  move?: { event: number; category: number };
  texts?: { id: number; lang: string; title: string; location: string; main: string };
  event?: Parameters<typeof edit>[1] & { id: number };
}) {
  const ctx = getCtx();
  if (!ctx.userId || !await node.isReadable() || await node.access() < 2) throw new AccessError();
  // an event, whatever module shows it, or a category to create and move them in
  const target = async (id: number, module?: string) => {
    const item = await node.cms.node(Number(id));
    if (!item.exists() || await item.access() < 2) throw new AccessError();
    if (module ? item.vs.module !== module : !await get(item)) throw new ApiError(400, "Invalid event target");
    return item;
  };
  if (input.event) {
    const { id, ...rest } = input.event;
    return edit(await target(id), rest);
  }
  if (input.texts) {
    const values = input.texts, event = await target(values.id);
    if (!node.app.languages.all.includes(values.lang)) throw new ApiError(400, "Unknown content language");
    if ([values.title, values.location, values.main].some((value) => typeof value !== "string") || !values.title.trim())
      throw new ApiError(400, "A title and valid content are required");
    await node.db.transaction(async () => {
      await event.title(values.lang, values.title);
      await event.text("location", values.lang, values.location);
      await event.text("main", values.lang, values.main);
    });
    return { ok: true };
  }
  if (input.create) {
    const title = typeof input.create.title === "string" ? input.create.title.trim() : "";
    if (!title) throw new ApiError(400, "A title is required");
    const { access } = await node.cms.fire("module:access", { module: EVENT, user: ctx.user ?? undefined, access: ADMIN });
    if (access < ADMIN) throw new AccessError();
    const parent = await target(input.create.parent, CATEGORY);
    // new events start private, owned by their creator
    const child = await node.db.transaction(async () => {
      const child = await parent.createCont({ module: EVENT, access: 0 });
      await child.changeUser(ctx.userId, ADMIN);
      await child.title(node.app.languages.def, title);
      return child;
    });
    return { id: child.id };
  }
  if (input.move) {
    const event = await target(input.move.event), category = await target(input.move.category, CATEGORY);
    if (!await category.insertBefore(event)) throw new ApiError(400, "Event could not be moved");
    return { ok: true };
  }
  return null;
}
