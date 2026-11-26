import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { deleteUnlinkedFs } from "../plugin.ts";

test("dbfiles: deleteUnlinkedFs keeps blobs referenced in version history and removes orphans", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  try {
    const write = async (text: string) => { await fs.write(dir + "a.txt", text); return dir + "a.txt"; };
    const file = await (await cms(app).node(1)).addFile(await write("old"));
    const oldMd5 = String(file.vs!.md5);
    await (await app.handle(new Request("http://qino.test/"))).body?.cancel(); // separate log_id for the replacement
    await file.replaceBy(await write("new"));

    const orphan = "0".repeat(32);
    await fs.write(app.dbFiles.directory + orphan, "orphan");

    const { deleted } = await deleteUnlinkedFs(app);
    assertEquals(deleted, 1);
    assertEquals(await fs.isFile(app.dbFiles.directory + orphan), false);
    assertEquals(await fs.isFile(app.dbFiles.directory + oldMd5), true);
  } finally {
    await new Promise((r) => setTimeout(r, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
