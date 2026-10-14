import { App, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";
import { configure, entities, save } from "@qino/qino/home";
import { history } from "@qino/qino/home.history";

Deno.test("manual providers need no URL and expose independent typed measurements through the protected APIs", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-manual-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  for (const name of ["home", "home.manual", "home.history", "cron", "home.record"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  try {
    await app.init();
    const first = await save(app, { name: "First", adapter: "manual" });
    const second = await save(app, { name: "Second", adapter: "manual" });
    const remote = { name: "Remote", adapter: "manual", config: { url: "https://not-needed.test/" } };
    await assertRejects(() => save(app, remote), Error, "configuration");
    const id = await configure(app, { provider: first, entity: "temperature", unit: "°C", record: true });
    const other = await configure(app, { provider: second, entity: "temperature", unit: "°C", record: true });
    const start = Date.now() + 1000;
    const user = await testContext({ app, set: { app, user: { id: 7, superuser: true } } });
    await requestStorage.run(user, async () => {
      await app.api["home.record"].datapoint(id).post({ time: start, value: -2.5 });
      await app.api["home.record"].datapoint(id).post({ time: start + 1, value: 0 });
      await app.api["home.record"].datapoint(other).post({ time: start, value: 83 });
    });
    assertEquals((await entities(app, first))[0].state, 0);
    assertEquals((await entities(app, second))[0].state, 83);
    assertEquals((await entities(app, first))[0].unit, "°C");
    const result = await history(app, id, { start: new Date(start).toISOString(), end: new Date(start + 2).toISOString(), source: "local" });
    assertEquals(result.samples, [{ time: start, value: -2.5 }, { time: start + 1, value: 0 }]);
    app.modules.unlink("home.record");
    app.modules.unlink("home.manual");
    await app.modules.link("home.record");
    await app.modules.link("home.manual");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals((await entities(app, first))[0].state, 0);
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, () => assertRejects(() => app.api["home.record"].datapoint(id).post({ time: start, value: 99 }), Error, "Access denied"));
  } finally { app.modules.unlink("home.record"); app.modules.unlink("cron"); await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
