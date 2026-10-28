import { assertEquals, assertRejects } from "@std/assert";
import { App, requestStorage } from "@qino/qino";

import { fakeSettings } from "./appFake.ts";

import type { Ctx } from "@qino/qino";

const app = (core: Record<string, string>) =>
  ({ settings: fakeSettings({ core: fakeSettings(core) }), url: App.prototype.url }) as unknown as App;

const on = <T>(host: string, run: () => Promise<T>) =>
  requestStorage.run({ req: { url: new URL(`https://${host}/shop/a`), appUrl: "/shop/" } } as unknown as Ctx, run);

Deno.test("app.url reads core.url and adds the missing slash", async () => {
  assertEquals(await app({ url: "https://abc.ch/shop" }).url(), "https://abc.ch/shop/");
  await assertRejects(() => app({}).url(), Error, "core.url is not set");
});

Deno.test("app.url answers the same inside a request, whatever host was asked for", async () => {
  assertEquals(await on("xy.ch", () => app({ url: "https://abc.ch/shop/" }).url()), "https://abc.ch/shop/");
  await assertRejects(() => on("xy.ch", () => app({}).url()), Error, "core.url is not set");
});

Deno.test("core.hosts: foreign hosts get a 421, the host of core.url and local hosts always pass", async () => {
  await using a = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  await a.init();
  const status = (host: string) => a.handle(new Request(`http://${host}/x.txt`)).then((res) => (res.body?.cancel(), res.status));
  assertEquals(await status("any.ch") === 421, false, "an empty list checks nothing");
  await a.settings.core.url("https://own.ch/");
  await a.settings.core.hosts("a.ch\n*.b.ch");
  assertEquals(await status("evil.ch"), 421);
  assertEquals(await status("8.8.8.8"), 421);
  for (const host of ["a.ch", "a.ch:8080", "x.b.ch", "own.ch", "localhost", "192.168.1.20", "[::1]"]) assertEquals((await status(host)) === 421, false, host);
  await new Promise((resolve) => setTimeout(resolve, 100)); // background log writes
});
