import { test } from "node:test";
import { assertEquals, assertRejects } from "@std/assert";
import { fakeSettings } from "@qino/qino/tests";
import { executable } from "@qino/qino/browser";

import { render } from "../mod.ts";

import type { App } from "@qino/qino";

const setup = (settings: Record<string, unknown> = {}) => ({ settings: fakeSettings({ browser: settings }) }) as unknown as App;

const installed = await executable(setup());

test("html is printed to a pdf, in the size of @page", { skip: !installed }, async () => {
  const bytes = await render(setup(), `<!doctype html><style>@page { size: A5 }</style><h1>Hallo</h1>`);
  const pdf = new TextDecoder().decode(bytes);
  assertEquals(pdf.slice(0, 5), "%PDF-");
  assertEquals(pdf.match(/MediaBox \[0 0 (\d+)/)?.[1], "420"); // A5: 420 pt wide
});

test("a browser that is not there fails with a clear error", async () => {
  await assertRejects(() => render(setup({ executable: "no-such-browser" }), "<p>x</p>"), Error, "no-such-browser");
});
