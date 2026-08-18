import { assertEquals, assertRejects } from "@std/assert";
import { App, requestStorage } from "@qino/qino";

import { fakeSettings } from "./appFake.ts";

import type { Ctx } from "@qino/qino";

const app = (core: Record<string, string>): App =>
  ({ settings: fakeSettings({ core: fakeSettings(core) }), url: App.prototype.url }) as unknown as App;

const on = <T>(host: string, run: () => Promise<T>): Promise<T> =>
  requestStorage.run({ req: { url: new URL(`https://${host}/shop/a`), appUrl: "/shop/" } } as unknown as Ctx, run);

Deno.test("app.url falls back to the canonical address without a request", async () => {
  assertEquals(await app({ url: "https://abc.ch/shop" }).url(), "https://abc.ch/shop/");
  await assertRejects(() => app({}).url(), Error, "core.url is not set");
});

Deno.test("app.url keeps the canonical address in a request, whatever host was asked for", async () => {
  assertEquals(await on("xy.ch", () => app({ url: "https://abc.ch/shop/" }).url()), "https://abc.ch/shop/");
  // nothing set yet: the request is all there is to go on
  assertEquals(await on("xy.ch", () => app({}).url()), "https://xy.ch/shop/");
});
