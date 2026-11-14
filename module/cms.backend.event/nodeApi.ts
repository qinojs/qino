import { AccessError, ApiError, getCtx } from "@qino/qino";
import { ADMIN } from "@qino/qino/cms";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, input: {
  create?: { parent: number; title: string; category?: boolean };
  move?: { event: number; category: number };
  visibility?: { id: number; inherit: boolean };
  texts?: { id: number; lang: string; title: string; location: string; main: string };
}) {
  if (!getCtx().userId || !await node.isReadable() || await node.access() < 2) throw new AccessError();
  const target = async (id: number, module?: string) => {
    const item = await node.cms.node(Number(id));
    if (!item.exists() || await item.access() < 2) throw new AccessError();
    if (module && item.vs.module !== module) throw new ApiError(400, "Invalid event target");
    return item;
  };
  if (input.texts) {
    const values = input.texts, event = await target(values.id, "cms.cont.event");
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
    const { parent: id, category } = input.create;
    const title = typeof input.create.title === "string" ? input.create.title.trim() : "";
    if (!title) throw new ApiError(400, "A title is required");
    const module = category ? "cms.cont.event.category" : "cms.cont.event";
    const ctx = getCtx();
    const access = await node.cms.fire("module:access", { module, user: ctx.user ?? undefined, access: ADMIN });
    if (access.access < ADMIN) throw new AccessError();
    const parent = await target(id, category ? undefined : "cms.cont.event.category");
    if (category && !parent.module?.plugin.cms?.node?.settingsSchema?.properties?.["default module"])
      throw new ApiError(400, "Choose a content list");
    const child = await node.db.transaction(async () => {
      const child = await parent.createCont({ module, ...(category ? {} : { access: 0 }) });
      await child.changeUser(ctx.userId, ADMIN);
      await child.title(node.app.languages.def, title);
      return child;
    });
    return { id: child.id, url: await child.url() };
  }
  if (input.move) {
    const event = await target(input.move.event, "cms.cont.event");
    const category = await target(input.move.category, "cms.cont.event.category");
    if (!await category.insertBefore(event)) throw new ApiError(400, "Event could not be moved");
    return { ok: true };
  }
  if (input.visibility) {
    const event = await target(input.visibility.id, "cms.cont.event");
    if (await event.access() < ADMIN) throw new AccessError();
    if (typeof input.visibility.inherit !== "boolean") throw new ApiError(400, "Invalid visibility");
    await event.set("access", input.visibility.inherit ? null : 0);
    return { ok: true };
  }
  return null;
}
