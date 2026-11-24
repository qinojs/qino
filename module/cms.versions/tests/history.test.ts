import { test } from "node:test";
import { App, fs, requestStorage } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

test("cms.versions: writes in a request leave snapshots, a delete one marked deleted", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  try {
    const db = app.db;
    const ctx = { app, logId: Promise.resolve("900010"), state: {} };
    await requestStorage.run(ctx as never, async () => {
      await db.table("page").insert({ id: 50, basis: 1, type: "p", module: "cms.cont.flexible" });
      await db.table("page").update(50, { name: "renamed" });
      await db.table("page").delete(50);
    });
    const rows = await db.query`SELECT name, _vers_log, _vers_space, _vers_deleted FROM _vers_page WHERE id = 50`;
    // one log entry, so the delete replaces the snapshot of the insert and update
    assertEquals(rows.map((r) => [r.name, Number(r._vers_log), Number(r._vers_space), Number(r._vers_deleted)]), [["renamed", 900010, 0, 1]]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("cms.versions: writes without request get a log entry of their own, a newer one after a request", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  try {
    const db = app.db;
    const names = async () => (await db.query`SELECT name, _vers_log FROM _vers_page WHERE id = 51 ORDER BY _vers_log`)
      .map((r) => [r.name, Number(r._vers_log)]);
    await db.table("page").insert({ id: 51, basis: 1, type: "p", module: "cms.cont.flexible" });
    await db.table("page").update(51, { name: "script" });
    const [[name, first]] = await names(); // insert and update share the entry
    assertEquals(name, "script");
    // a request's log entry comes in between: the next write without request needs a newer one
    const ctx = { app, logId: Promise.resolve(null), state: {} };
    await requestStorage.run(ctx as never, () => db.table("log").insert({ time: 1 }));
    await db.table("page").update(51, { name: "cron" });
    const rows = await names();
    assertEquals(rows.map(([n]) => n), ["script", "cron"]);
    assertEquals(Number(rows[1][1]) > first, true);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
