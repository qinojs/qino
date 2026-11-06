// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { App, fs, runAs, sys } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { executable, open } from "../mod.ts";

const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
app.modules.add(new URL("../plugin.ts", import.meta.url));
await app.init();
const installed = await executable(app);
const as = (usrId: number, fn: (browser: any) => Promise<any>): Promise<any> => runAs(app, usrId, "test", () => fn((app.api as any).browser));

test("browser: an own page loads from our own network, a guarded one does not", { skip: !installed }, async () => {
  const stop = new AbortController(), port = 30_000 + Math.floor(Math.random() * 20_000);
  sys.serve({ port, hostname: "127.0.0.1", signal: stop.signal }, () => new Response("<h1>Own</h1>", { headers: { "content-type": "text/html" } }));
  const url = `http://127.0.0.1:${port}/`;
  try {
    const own = await open(app, { guard: false });
    await own.goto(url);
    assertEquals(await own.locator("h1").textContent(), "Own");
    await own.close();

    const guarded = await open(app);
    assertEquals((await guarded.goto(url))?.status(), 403); // told by the proxy, not our server
    assertEquals(await guarded.locator("h1").count(), 0);
    await assertRejects(() => guarded.goto(`https://127.0.0.1:${port}/`), Error, "ERR_TUNNEL_CONNECTION_FAILED");
    await assertRejects(() => guarded.goto(`http://localhost:${port}/`), Error);
    await guarded.close();
  } finally {
    stop.abort();
  }
});

test("browser: elements are found by the refs of the snapshot", { skip: !installed }, async () => {
  const page = await open(app, { guard: false });
  await page.setContent(`<button onclick="this.textContent = 'Done'">Go</button>`);
  const ref = (await page.ariaSnapshot({ mode: "ai" })).match(/button "Go" \[ref=(\w+)\]/)![1];
  await page.locator(`aria-ref=${ref}`).click();
  assertEquals(await page.locator("button").textContent(), "Done");
  await page.close();
});

test("browser: the api opens pages for their user only, and to http(s) only", { skip: !installed }, async () => {
  await app.settings.core.url("https://example.test/");
  await app.db.table("usr").insert([{ id: 7, username: "ann@example.test", active: true }, { id: 8, username: "bob@example.test", active: true }]);
  const { id, url } = await as(7, (b) => b.open.post({}));
  assertEquals(url, "about:blank");
  await assertRejects(() => as(7, (b) => b.goto.post({ id, url: "file:///etc/passwd" })), Error, "http or https");
  await assertRejects(() => as(8, (b) => b.snapshot.get(undefined, { id })), Error, `No page ${id}`);
  assertEquals((await as(7, (b) => b.snapshot.get(undefined, { id }))).id, id);
  assertEquals(await as(7, (b) => b.close.post({ id })), { closed: id });
  await assertRejects(() => as(7, (b) => b.snapshot.get(undefined, { id })), Error, `No page ${id}`);
});
