// deno-lint-ignore-file no-explicit-any
import { Access, AccessError, App, NotFoundError, runAs, s } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

/** A real app with sandbox.flow, superusers 7 and 8, user 9, and a route as tool: post_test_greet. */
async function withApp(fn: (app: App, as: (usr: number, call: () => Promise<any>) => Promise<any>) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.modules.add(new URL("../../sandbox/plugin.ts", import.meta.url));
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  await app.init();
  const greet = { post: { access: Access.USER, input: s.object({ name: s.string() }), execute: () => "greeted" } };
  app.apiTree = { ...app.apiTree, test: { greet } };
  try {
    await app.settings.core.url("https://example.test/");
    for (const id of [7, 8, 9]) {
      await app.db.table("usr").insert({ id, username: `u${id}@example.test`, active: true, superuser: id !== 9 });
    }
    await fn(app, (usr, call) => runAs(app, usr, "test", call));
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
}

const made = {
  description: "greet on every usr update",
  host: "db",
  event: "table:update-after",
  tools: ["post_test_greet"],
  steps: [{
    description: "greet",
    fn: "async (e, { tools }) => (await tools.post_test_greet({ name: e.table }), true)",
  }],
};

Deno.test("sandbox.flow api: make, read, change, try and delete your own flows", () => withApp(async (app, as) => {
  const flows = (app.api as any)["sandbox.flow"].flows;
  const { id } = await as(7, () => flows.post(made));
  const flow = await as(7, () => flows(id).get());
  assertEquals([flow.description, flow.on, flow.tools, flow.steps, flow.test, flow.active],
    [made.description, { host: "db", event: "table:update-after" }, made.tools, made.steps, true, false]);
  assertEquals((await as(7, () => flows.get())).map((f: any) => f.id), [id]);

  await as(7, () => flows(id).patch({ active: true, test: false }));
  assertEquals([(await as(7, () => flows(id).get())).active, (await as(7, () => flows(id).get())).test], [true, false]);

  // a try is a test run, whatever the flow says: only get_* tools take effect
  const trace = await as(7, () => flows(id).test.post({ event: { table: "usr" }, user: 7 }));
  assertEquals([trace.end, trace.context, trace.steps[0].calls[0].skipped], ["done", { user: 7 }, true]);

  await as(7, () => flows(id).delete());
  assertEquals(await as(7, () => flows.get()), []);
}));

Deno.test("sandbox.flow api: someone else's flow does not exist for you", () => withApp(async (app, as) => {
  const flows = (app.api as any)["sandbox.flow"].flows;
  const { id } = await as(7, () => flows.post(made));
  assertEquals(await as(8, () => flows.get()), []);
  await assertRejects(() => as(8, () => flows(id).get()), NotFoundError);
  await assertRejects(() => as(8, () => flows(id).patch({ active: true })), NotFoundError);
  await assertRejects(() => as(8, () => flows(id).delete()), NotFoundError);
  assertEquals(Number(await app.db.one`SELECT usr_id FROM flow WHERE id = ${id}`), 7); // the owner is who made it
}));

// events are not filtered by rights yet: a flow sees every event of its host
Deno.test("sandbox.flow api: only superusers", () => withApp(async (app, as) => {
  const flows = (app.api as any)["sandbox.flow"].flows;
  await assertRejects(() => as(9, () => flows.get()), AccessError);
  await assertRejects(() => as(9, () => flows.post(made)), AccessError);
}));

Deno.test("sandbox.flow api: the catalog tells what a flow can listen to and what the tables mean", () =>
  withApp(async (app, as) => {
    const { hosts, tables, tools } = await as(7, () => (app.api as any)["sandbox.flow"].catalog.get());
    const greet = tools.find((tool: any) => tool.name === "post_test_greet");
    assertEquals(Object.keys(greet.parameters.properties), ["name"]);
    assertEquals(Object.keys(hosts), ["app", "db"]);
    const inserted = hosts.db["table:insert-after"];
    assertEquals(inserted.description, "A row was inserted.");
    assertEquals(inserted.data.properties.table.description, "The table.");
    assertEquals(Object.keys(inserted.data.properties), ["table", "id", "data"]);
    assertEquals(hosts.app.suspicious.data.required, ["ctx"]);
    const host = "The object whose event starts it, from the app: app, db";
    assertEquals(tables.flow.host, { type: "string", description: host });
  }));
