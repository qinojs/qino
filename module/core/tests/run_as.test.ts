import { App, getCtx, requestStorage, runAs } from "../mod.ts";
import { assertEquals, assertRejects } from "./deps.ts";

Deno.test("runAs: a context of its own, with the user's rights, through its actor", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  await app.init();
  try {
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await assertRejects(() => runAs(app, 7, "job", () => {}), Error, "core.url"); // nowhere to point its request
    await app.settings.core.url("https://example.test/sub/");
    await assertRejects(() => runAs(app, 0, "job", () => {}), Error, "needs a user");

    const seen = () => {
      const ctx = getCtx();
      return { user: ctx.user?.id, client: ctx.clientId, url: ctx.req.url.href, appUrl: ctx.req.appUrl };
    };
    const first = await runAs(app, 7, "ai.tools", seen);
    assertEquals([first.user, first.url, first.appUrl], [7, "https://example.test/sub/", "/sub/"]);
    assertEquals((await runAs(app, 7, "ai.tools", seen)).client, first.client); // one actor, one client
    assertEquals((await runAs(app, 7, "cron", seen)).client === first.client, false);

    // what it writes carries its log entry, which names the actor's session and client
    const logId = await runAs(app, 7, "ai.tools", async () => {
      await app.db.table("grp").insert({ name: "made by the agent" });
      return getCtx().logId;
    });
    assertEquals(await app.db.one`SELECT log_id FROM grp`, Number(logId));
    assertEquals(String(await app.db.one`SELECT client_id FROM log WHERE id = ${logId}`), first.client);

    // `state` is there before the setup writes, so a listener can tell those writes are this run's
    const writes: unknown[] = [];
    const stop = new AbortController();
    const mark = () => void writes.push(requestStorage.getStore()?.state.mark);
    app.db.on("table:insert-after", mark, { signal: stop.signal });
    await runAs(app, 7, "fresh", () => {}, { state: { mark: "mine" } }); // a new actor: its client is inserted
    stop.abort();
    assertEquals(writes.length > 0 && writes.every((mark) => mark === "mine"), true);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
