import { assertEquals, assertRejects } from "@std/assert";
import { App, requestStorage } from "@qino/qino";

import { fakeSettings } from "./appFake.ts";

import type { Ctx } from "@qino/qino";

const app = (core: Record<string, string>): App =>
  ({ settings: fakeSettings({ core: fakeSettings(core) }), url: App.prototype.url }) as unknown as App;

const on = <T>(host: string, run: () => Promise<T>): Promise<T> =>
  requestStorage.run({ req: { url: new URL(`https://${host}/shop/a`), appUrl: "/shop/" } } as unknown as Ctx, run);

Deno.test("app.url reads core.url and adds the missing slash", async () => {
  assertEquals(await app({ url: "https://abc.ch/shop" }).url(), "https://abc.ch/shop/");
  await assertRejects(() => app({}).url(), Error, "core.url is not set");
});

Deno.test("app.url answers the same inside a request, whatever host was asked for", async () => {
  assertEquals(await on("xy.ch", () => app({ url: "https://abc.ch/shop/" }).url()), "https://abc.ch/shop/");
  await assertRejects(() => on("xy.ch", () => app({}).url()), Error, "core.url is not set");
});
