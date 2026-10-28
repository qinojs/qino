import { Access, s } from "@qino/qino";

import { imageUrl } from "./mod.ts";

import type { ApiTree, App, Ctx, Params } from "@qino/qino";

/** Each user keeps their own image. */
export const api: ApiTree = {
  get: {
    description: "The URL of one's own image, or null",
    access: Access.USER,
    execute: async (_: Params, ctx: Ctx) => ({ image: await imageUrl(ctx.app, ctx.userId!) ?? null }),
  },
  put: {
    description: "Set one's image from a data: URI; the old one is removed",
    access: Access.USER,
    input: s.object({ dataUrl: s.string().describe("data:image/…;base64,…") }),
    execute: async ({ dataUrl }: Params, ctx: Ctx) => {
      if (!String(dataUrl).startsWith("data:image/")) throw new Error("Choose an image");
      const fresh = await ctx.app.dbFiles.add(String(dataUrl));
      if (!fresh.mime.startsWith("image/")) {
        await fresh.remove();
        throw new Error("Choose an image");
      }
      await replace(ctx.app, ctx.userId!, fresh.id);
      return { image: await imageUrl(ctx.app, ctx.userId!) };
    },
  },
  delete: {
    description: "Remove one's image",
    access: Access.USER,
    execute: async (_: Params, ctx: Ctx) => {
      await replace(ctx.app, ctx.userId!, null);
      return { ok: true };
    },
  },
};

async function replace(app: App, usrId: number, fileId: number | null) {
  const old = await app.db.one`SELECT image_id FROM usr WHERE id = ${usrId}`;
  await app.db.table("usr").update(usrId, { image_id: fileId });
  if (!old) return;
  const file = await app.dbFiles.file(Number(old));
  if (!await file.used()) await file.remove();
}
