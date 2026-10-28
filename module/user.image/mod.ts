import type { App } from "@qino/qino";

/** URL of a user's image, `size` pixels square; undefined without one. */
export async function imageUrl(app: App, usrId: number, size = 400): Promise<string | undefined> {
  const id = await app.db.one`SELECT image_id FROM usr WHERE id = ${usrId}`;
  return id ? await (await app.dbFiles.file(Number(id))).url({ w: size, h: size }) : undefined;
}
