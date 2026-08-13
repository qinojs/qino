// Public API of the identity module. The qino-module manifest is in ./plugin.ts.
// Data only — how the brand looks belongs to whoever renders it (see the u2 module).
import type { App, DbFile } from "@qino/qino";

/** An uploaded brand asset — "logo", "icon" or "font"; undefined while none is set. */
export async function file(app: App, name: string): Promise<DbFile | undefined> {
  const id = Number(await app.db.one`SELECT file_id FROM identity_file WHERE name = ${name}`);
  return id ? await app.dbFiles.file(id) : undefined;
}
