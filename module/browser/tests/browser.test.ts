// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { App, fs, runAs, sys } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { Playwright } from "../lib/playwright.ts";
import { proxy } from "../lib/proxy.ts";
import { Puppeteer } from "../lib/puppeteer.ts";
import { executable } from "../mod.ts";

import type { Page } from "../mod.ts";

const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
app.modules.add(new URL("../plugin.ts", import.meta.url));
await app.init();
const cmd = await executable(app);
const as = (usrId: number, fn: (browser: any) => Promise<any>): Promise<any> =>
  runAs(app, usrId, "test", () => fn((app.api as any).browser));
const text = (page: Page, selector: string) => page.evaluate(`document.querySelector("${selector}").textContent`);
const ref = (tree: string, element: string) => tree.match(new RegExp(`${element}.*?\\[ref=(\\w+)\\]`))![1];

const PAGES: Record<string, string> = {
  "/": `<title>Start</title><h1>Hi</h1>
    <button onclick="this.textContent = 'Done'">Go</button>
    <input aria-label=Name>
    <select aria-label=Color><option value=r>Red<option value=g>Green</select>
    <button onclick="confirm('Sure?') && (this.textContent = 'Yes')">Ask</button>
    <a href="/b" target=_blank>Next</a>
    <script>console.error("boom")</script>`,
  "/b": `<title>B</title><p>Second`,
};
const stop = new AbortController(), port = 30_000 + Math.floor(Math.random() * 20_000);
const base = `http://127.0.0.1:${port}`;
sys.serve({ port, hostname: "127.0.0.1", signal: stop.signal }, (req) =>
  new Response(PAGES[new URL(req.url).pathname] ?? "", { headers: { "content-type": "text/html" } }));

/** Until `check` holds, or a while has passed. */
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
}

for (const Driver of [Playwright, Puppeteer]) {
  const missing = !cmd || !!await Driver.missing();

  const title = `browser: ${Driver.name} acts by the refs of its snapshot and tells what the page did`;
  test(title, { skip: missing }, async () => {
    const browser = await Driver.launch(cmd!), page = await browser.page();
    try {
      assertEquals((await page.goto(`${base}/`))?.status(), 200);
      const tree = await page.snapshot();
      await page.click(ref(tree, 'button "Go"'));
      assertEquals(await text(page, "button"), "Done");
      await page.fill(ref(tree, 'textbox "Name"'), "Ann");
      await page.selectOption(ref(tree, 'combobox "Color"'), ["g"]);
      const values = `[document.querySelector("input").value, document.querySelector("select").value]`;
      assertEquals(await page.evaluate(values), ["Ann", "g"]);
      assertEquals((await page.news()).console, [{ type: "error", text: "boom" }]);
      assertEquals((await page.news()).console, undefined); // told once

      const asked = page.click(ref(tree, 'button "Ask"'));
      await page.dialogOpened();
      assertEquals((await page.news()).dialog, "Sure?");
      await page.handleDialog(true);
      await asked;
      assertEquals(await text(page, "button:nth-of-type(2)"), "Yes");

      await page.click(ref(tree, 'link "Next"')); // opens a tab: the page goes on there
      await until(() => page.url().endsWith("/b"));
      await page.waitForLoadState();
      assertEquals((await page.news()).tabs?.map((t) => t.url), [`${base}/`, `${base}/b`]);
      await page.tab(0);
      await page.goto(`${base}/b`);
      await page.goBack();
      assertEquals(page.url(), `${base}/`);

      assertEquals(page.requests().some((r) => r.url === `${base}/b` && r.status === 200), true);
      assertEquals([...(await page.screenshot()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // png
      await assertRejects(() => page.tab(5), Error, "No tab 5");
    } finally {
      await page.close();
      await browser.close();
    }
  });

  test(`browser: ${Driver.name} behind the proxy reaches no own address`, { skip: missing }, async () => {
    const guard = await proxy(), browser = await Driver.launch(cmd!);
    const page = await browser.page({ proxy: guard.server });
    try {
      assertEquals((await page.goto(`${base}/`))?.status(), 502); // told by the proxy, not our server
      assertEquals(await text(page, "body"), "SSRF blocked: 127.0.0.1");
      assertEquals((await page.goto(`http://localhost:${port}/`))?.status(), 502);
      await assertRejects(() => page.goto(`https://127.0.0.1:${port}/`), Error, "ERR_TUNNEL_CONNECTION_FAILED");
    } finally {
      await page.close();
      await browser.close();
      guard.close();
    }
  });
}

test("browser: the api opens pages for their user only, and to http(s) only", { skip: !cmd }, async () => {
  await app.settings.core.url("https://example.test/");
  await app.db.table("usr").insert([
    { id: 7, username: "ann@example.test", active: true },
    { id: 8, username: "bob@example.test", active: true },
  ]);
  const { id, url } = await as(7, (b) => b.open.post({}));
  assertEquals(url, "about:blank");
  await assertRejects(() => as(7, (b) => b.goto.post({ id, url: "file:///etc/passwd" })), Error, "http or https");
  await assertRejects(() => as(8, (b) => b.snapshot.get(undefined, { id })), Error, `No page ${id}`);
  assertEquals((await as(7, (b) => b.snapshot.get(undefined, { id }))).id, id);
  assertEquals(await as(7, (b) => b.console.get(undefined, { id })), []);
  assertEquals(await as(7, (b) => b.close.post({ id })), { closed: id });
  await assertRejects(() => as(7, (b) => b.snapshot.get(undefined, { id })), Error, `No page ${id}`);
  stop.abort();
});
