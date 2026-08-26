import { assertEquals } from "@std/assert";
import { Db } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };
import { ingest, outbox, posts, ProviderError, publish, targets } from "../mod.ts";

import type { App } from "@qino/qino";
import type { Provider } from "../mod.ts";

async function testApp(socialProvider: Provider | Provider[]): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  db.schema = dbSchema;
  return {
    db,
    modules: { linked: () => [socialProvider].flat().map((socialProvider) => ({ plugin: { socialProvider } })) },
  } as unknown as App;
}

Deno.test("social target discovery isolates providers", async () => {
  const app = await testApp([
    { name: "good", targets: () => Promise.resolve([{ id: "a", label: "A" }]), publish: () => Promise.reject() },
    { name: "broken", targets: () => Promise.reject(new Error("Broken")), publish: () => Promise.reject() },
  ]);
  assertEquals(await targets(app), [{ provider: "good", id: "a", label: "A" }]);
});

Deno.test("social publishes one row per target and records when it was sent", async () => {
  const provider: Provider = {
    name: "fake",
    targets: () => Promise.resolve([{ id: "a", label: "A" }, { id: "b", label: "B" }]),
    publish: (_app, target, text) => Promise.resolve({ target, id: "remote-" + target, text, own: true, time: 20 }),
  };
  const app = await testApp(provider);
  assertEquals(await targets(app), [
    { provider: "fake", id: "a", label: "A" },
    { provider: "fake", id: "b", label: "B" },
  ]);
  const available = await targets(app);
  const rows = await publish(app, [...available, available[0]], "Hello");
  assertEquals(rows.map((row) => [row.target, row.remote_id, Boolean(row.sent), Number(row.own), row.time, row.error]), [
    ["a", "remote-a", true, 1, 20, null],
    ["b", "remote-b", true, 1, 20, null],
  ]);
});

Deno.test("social retries an explicitly temporary failure without adding another row", async () => {
  let calls = 0;
  const provider: Provider = {
    name: "fake",
    targets: () => Promise.resolve([{ id: "a", label: "A" }]),
    publish: (_app, target, text) => ++calls === 1
      ? Promise.reject(new ProviderError("Later", 0))
      : Promise.resolve({ target, id: "remote-a", text, own: true, time: 20 }),
  };
  const app = await testApp(provider);
  const [pending] = await publish(app, await targets(app), "Hello");
  assertEquals([pending.remote_id, pending.time, pending.sent, pending.attempts, pending.error], [null, null, null, 1, "Later"]);
  assertEquals(await outbox(app), 1);
  const rows = await app.db.query`SELECT * FROM social_post`;
  assertEquals(rows.map((row) => [row.remote_id, row.attempts, row.error]), [["remote-a", 1, null]]);
});

Deno.test("social imports remote posts idempotently without marking them sent", async () => {
  const provider: Provider = { name: "fake", targets: () => Promise.resolve([]), publish: () => Promise.reject() };
  const app = await testApp(provider);
  const remote = { target: "a", id: "7", text: "Remote", own: true, time: 10 };
  assertEquals(await ingest(app, "fake", [remote]), 1);
  assertEquals(await ingest(app, "fake", [{ ...remote, text: "Edited" }]), 0);
  const [post] = await posts(app);
  assertEquals([post.text, post.sent, Number(post.own), post.time], ["Edited", null, 1, 10]);
});
