import type { App } from "@qino/qino";

/** image2 named its language variants `image_<lang>`, cms.cont.image reads `image <lang>`. Before the
 *  rename, while the nodes still carry the legacy module name. */
export async function migrateImage2(app: App): Promise<void> {
  const rows = (await app.db.query`SELECT pf.page_id, pf.name FROM page_file pf JOIN page p ON p.id = pf.page_id
    WHERE p.module = ${"cms.cont.image2"}`).filter((row) => String(row.name).startsWith("image_"));
  for (const { page_id, name } of rows) {
    await app.db.exec`UPDATE page_file SET name = ${"image " + String(name).slice(6)} WHERE page_id = ${page_id} AND name = ${name}`;
  }
  if (rows.length) console.log(`[migrate_from_php] image2: ${rows.length} files image_<lang> → image <lang>`);
}
