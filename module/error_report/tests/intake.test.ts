import { App } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

Deno.test("error_report: a browser report sets only what a browser can know", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("error_report");
  await app.init();
  try {
    await app.settings.error_report.browserErrors(true);
    const body = JSON.stringify({ message: "boom", line: 3, id: 9_000_000_000_000, ip: "6.6.6.6", bot: true, source: "php" });
    const res = await app.handle(new Request("http://qino.test/js-error", { method: "POST", body, headers: { "content-type": "application/json" } }));
    await res.body?.cancel();
    const row = (await app.db.row`SELECT id, message, line, ip, bot, source FROM m_error_report`)!;
    assertEquals([row.message, Number(row.line), row.source], ["boom", 3, "js"]);
    assertEquals(Number(row.id) < 1000 && row.ip !== "6.6.6.6" && !row.bot, true, "id, ip and flags are the server's");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
