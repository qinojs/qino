import { App, unixTime } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { thinHistory } from "../maintenance.ts";

Deno.test("cms.versions: thinHistory keeps the newest entry of a bucket, and entries in other buckets", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  try {
    const db = app.db;
    const page = (await db.row`SELECT * FROM page WHERE id = 1`)!;
    // two saves 30s apart two weeks ago share a bucket (aligned, so no boundary falls between
    // them); one from two hours ago is in its own
    const SPAN = 60 * 2 ** 14;
    const old = Math.floor((unixTime() - 14 * 86400) / SPAN) * SPAN;
    for (const [id, time] of [[900001, old], [900002, old + 30], [900003, unixTime() - 7200]]) {
      await db.table("log").insert({ id, time, post: "" });
      await db.table("_vers_page").insert({ ...page, _vers_log: id, _vers_space: 0, _vers_deleted: 0 });
    }
    assertEquals(await thinHistory(db, true), 1);
    assertEquals(await thinHistory(db), 1);
    assertEquals((await db.col`SELECT _vers_log FROM _vers_page WHERE id = 1 AND _vers_log > 900000 ORDER BY _vers_log`).map(Number), [900002, 900003]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
