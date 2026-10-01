// deno-lint-ignore-file no-explicit-any
import { Access, App, NotFoundError, runAs, s } from "@qino/qino";
import { assert, assertEquals, assertRejects } from "@qino/qino/tests";
import { collections, create, drop } from "@qino/qino/ai1.embed";

import type { Adapter } from "@qino/qino/ai1";

// Texts that mention a greeting embed apart; queries too.
const fake: Adapter = {
  embed: (_call, { texts }) => Promise.resolve(texts.map((t: string) => /greet/i.test(t) ? [1, 0] : [0, 1])),
} as Adapter;

/** A real app with ai1.discover, user 7, superuser 8, and routes as tools: one for users, one for superusers. */
async function withApp(fn: (app: App, as: (usr: number, call: () => Promise<any>) => Promise<any>) => Promise<void>, embed = true) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "cron", "ai1.embed", "ai1.discover"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  app.modules.get("ai1")!.plugin.ai1Adapters.fake = fake;
  const greet = { post: { description: "Greet someone", access: Access.USER, input: s.object({ name: s.string() }), execute: () => "greeted" } };
  const purge = { post: { description: "Purge everything", access: Access.SUPERUSER, execute: () => "purged" } };
  app.apiTree = { ...app.apiTree, test: { greet, purge } };
  try {
    await app.settings.core.url("https://example.test/");
    for (const id of [7, 8]) await app.db.table("usr").insert({ id, username: `u${id}@example.test`, active: true, superuser: id === 8 });
    await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai1_model").insert({ name: "m" });
    await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    await app.db.table("ai1_model_capability").insert({ model_id: 1, capability: "embed" });
    for (const { id } of await collections(app)) await drop(app, id);
    if (embed) await create(app, "m", 2);
    await fn(app, (usr, call) => runAs(app, usr, "test", call));
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    delete app.modules.get("ai1")!.plugin.ai1Adapters.fake;
    await app.db.close();
  }
}

const api = (app: App) => (app.api as any)["ai1.discover"];

Deno.test("ai1.discover: tables, events and tools by name, each in detail", () => withApp(async (app, as) => {
  const tables = await as(7, () => api(app).tables.get());
  assert(tables.some((t: any) => t.name === "usr"));
  const usr = await as(7, () => api(app).table("usr").get());
  assertEquals(usr, (app.db.schema.properties as any).usr);
  const events = await as(7, () => api(app).events.get());
  assertEquals(events.find((e: any) => e.name === "db:table:insert-after").description, "A row was inserted.");
  const inserted = await as(7, () => api(app).event("db:table:insert-after").get());
  assertEquals(Object.keys(inserted.data.properties), ["table", "id", "data"]);
  const tool = await as(7, () => api(app).tool("post_test_greet").get());
  assertEquals(Object.keys(tool.parameters.properties), ["name"]);
  await assertRejects(() => as(7, () => api(app).table("nope").get()), NotFoundError);
}));

Deno.test("ai1.discover: tools only those the caller may call", () => withApp(async (app, as) => {
  const names = async (usr: number) => (await as(usr, () => api(app).tools.get())).map((t: any) => t.name);
  assert(!(await names(7)).includes("post_test_purge"));
  assert((await names(8)).includes("post_test_purge"));
  await assertRejects(() => as(7, () => api(app).tool("post_test_purge").get()), NotFoundError);
}));

Deno.test("ai1.discover: search by meaning, indexed on first use", () => withApp(async (app, as) => {
  const [first] = await as(7, () => api(app).tools.get(undefined, { search: "say hello, greet" }));
  assertEquals(first.name, "post_test_greet");
  const kept = Number(await app.db.one`SELECT COUNT(*) FROM embedding_ai1_discover WHERE kind = ${"tools"}`);
  assert(kept > 1); // all tools, not only the caller's
  await as(7, () => api(app).tools.get(undefined, { search: "greet" })); // unchanged: not indexed again
  assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM embedding_ai1_discover WHERE kind = ${"tools"}`), kept);
  const hits = await as(7, () => api(app).tools.get(undefined, { search: "purge" }));
  assert(!hits.some((t: any) => t.name === "post_test_purge"));
}));

Deno.test("ai1.discover: without an embedding collection, search by words", () => withApp(async (app, as) => {
  const hits = (await as(7, () => api(app).tables.get(undefined, { search: "collection_id" }))).map((t: any) => t.name);
  assert(hits.includes("embedding_ai1_discover") && !hits.includes("usr"));
}, false));
