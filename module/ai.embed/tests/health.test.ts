import { assertEquals } from "@qino/qino/tests";

import { create } from "../lib/collection.ts";
import { healthChecks } from "../healthChecks.ts";
import { fakeApp } from "./fake.ts";

Deno.test("ai.embed: health tells a collection's model nobody offers, or nobody has a key for", async () => {
  const { app, db } = await fakeApp("sqlite::memory:");
  const checks = healthChecks(app);
  const offered = checks.error["embedding model offered by no provider"], keyed = checks.warning["embedding model without a key"];
  await create(app, "multi", 2);
  assertEquals(await offered(), undefined);
  assertEquals((await keyed())?.info, "multi: none of its providers has a key in core.keys");
  (app.settings.core.keys as unknown as Record<string, string>).fake = "key";
  assertEquals(await keyed(), undefined);
  await create(app, "gone", 3);
  assertEquals((await offered())?.info, "gone: no vectors can be made or searched");
  await db.close();
});
