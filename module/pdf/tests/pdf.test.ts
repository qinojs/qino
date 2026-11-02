import { test } from "node:test";
import { fs } from "@qino/qino";
import { assertEquals, assertRejects } from "@std/assert";
import { fakeSettings } from "@qino/qino/tests";

import { browser } from "../lib/browser.ts";
import { render } from "../mod.ts";

import type { App } from "@qino/qino";

async function setup(settings: Record<string, unknown> = {}) {
  const dir = await fs.tempDir();
  const app = {
    settings: fakeSettings({ pdf: settings }),
    modules: { get: (name: string) => ({ tmp: `${dir}/tmp/${name}/` }) },
  } as unknown as App;
  return { app, dir };
}

const installed = await browser((await setup()).app);

test("html is printed to a pdf, and nothing is left behind", { skip: !installed }, async () => {
  const { app, dir } = await setup();
  const bytes = await render(app, `<!doctype html><style>@page { size: A5 }</style><h1>Hallo</h1>`);
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assertEquals(await fs.list(`${dir}/tmp/pdf/`), []);
  await fs.remove(dir, { recursive: true });
});

test("a browser that is not there fails with a clear error", async () => {
  const { app, dir } = await setup({ browser: "no-such-browser" });
  await assertRejects(() => render(app, "<p>x</p>"), Error, "no-such-browser did not run");
  await fs.remove(dir, { recursive: true });
});
