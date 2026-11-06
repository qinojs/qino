// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { App, fs, runAs, sys } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { executable, open } from "../mod.ts";

import type { Page } from "../mod.ts";

const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
app.modules.add(new URL("../plugin.ts", import.meta.url));
await app.init();
const installed = await executable(app);
const text = (page: Page, selector: string) => page.evaluate(`document.querySelector("${selector}").textContent`);
const as = (usrId: number, fn: (browser: any) => Promise<any>): Promise<any> => runAs(app, usrId, "test", () => fn((app.api as any).browser));

test("browser: an own page loads from our own network, a guarded one does not", { skip: !installed }, async () => {
  const stop = new AbortController(), port = 30_000 + Math.floor(Math.random() * 20_000);
  sys.serve({ port, hostname: "127.0.0.1", signal: stop.signal }, () => new Response("<h1>Own</h1>", { headers: { "content-type": "text/html" } }));
  const url = `http://127.0.0.1:${port}/`;
  try {
    const own = await open(app, { guard: false });
    await own.goto(url);
    assertEquals(await text(own, "h1"), "Own");
    await own.close();

    const guarded = await open(app);
    assertEquals((await guarded.goto(url))?.status(), 502); // told by the proxy, not our server
    assertEquals(await text(guarded, "body"), "SSRF blocked: 127.0.0.1");
    await assertRejects(() => guarded.goto(`https://127.0.0.1:${port}/`), Error, "ERR_TUNNEL_CONNECTION_FAILED");
    assertEquals((await guarded.goto(`http://localhost:${port}/`))?.status(), 502);
    await guarded.close();
  } finally {
    stop.abort();
  }
});

test("browser: elements are found by the refs of the snapshot", { skip: !installed }, async () => {
  const page = await open(app, { guard: false });
  await page.setContent(`<h1>Hi</h1><button onclick="this.textContent = 'Done'">Go</button>`);
  const tree = await page.snapshot();
  assertEquals(tree, '- heading "Hi" [level=1] [ref=e1]\n- button "Go" [ref=e2]');
  await page.click("e2");
  assertEquals(await text(page, "button"), "Done");
  await assertRejects(() => page.click("e99"), Error, "No element e99");
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
