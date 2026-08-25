import { Db, requestStorage } from "@qino/qino";
import { setTransport } from "@qino/qino/messaging.email";
import { assert, assertEquals, assertRejects, contactDbSchema, DbFileManager, fakeT, fileDbSchema, messagingDbSchema } from "@qino/qino/tests";

import more from "../view/widgets/more.ts";

import type { App, Ctx } from "@qino/qino";

/** Just enough app for the email channel to journal and deliver. */
async function makeApp(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...fileDbSchema.properties, ...messagingDbSchema.properties, ...contactDbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, given_name TEXT, family_name TEXT, organization TEXT)`;
  await db.query`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.loadTables();
  const dir = await Deno.makeTempDir();
  const app = {
    db,
    dir,
    settings: {
      cms: { feedback: { email: "support@example.test" } },
      messaging: { _secret: "test-secret" },
      "messaging.email": { address: "app@example.test", name: "", inbound: {}, transport: { smtp: {} } },
    },
    languages: { all: [] },
    url: () => Promise.resolve("https://example.test/"),
    modules: { linked: () => [] },
    t: fakeT,
  } as unknown as App;
  app.dbFiles = new DbFileManager(app, dir + "/files/");
  return app;
}

async function close(app: App): Promise<void> {
  await app.db.close();
  await Deno.remove(app.dir, { recursive: true });
}

Deno.test("cms.frontend.4 more: sends escaped feedback over the email channel", async () => {
  let draft = "draft";
  const ctx = {
    req: { header: (name: string) => name === "user-agent" ? "Test Browser" : undefined },
    user: { given_name: "Ada", family_name: "Lovelace", username: "ada", contact: () => Promise.resolve("ada@example.test") },
    settings: {
      cms: {
        feedback: { text: (value?: string) => value === undefined ? draft : draft = value },
      },
      core: { lang_ns: { cms: () => "" } },
      "cms.frontend.4": { ui: { tree_show_c: () => false } },
    },
  } as unknown as Ctx;
  const app = await makeApp();
  const posted: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (posted.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });
  const node = { app };

  const html = String(await requestStorage.run(ctx, () => more(node as never, {
    param: { msg: "<b>Hello</b>\nWorld", link: "https://example.test/?a=<b>" },
  })));

  assertEquals(String((posted[0].recipients as { address: string }[])[0].address), "support@example.test");
  assertEquals(String((posted[0].replyRecipients as { address: string }[])[0].address), "ada@example.test");
  assertEquals(String(posted[0].subject), "CMS feedback");
  assertEquals(draft, "");
  assert(String((posted[0].content as { html: string }).html).includes("&lt;b&gt;Hello&lt;/b&gt;<br>World"));
  assert(html.includes("Thank you for your feedback."));
  assert(html.includes("class=-tour"));

  await close(app);
});

Deno.test("cms.frontend.4 more: keeps feedback draft when sending fails", async () => {
  let draft = "Please help";
  const ctx = {
    req: { header: () => undefined },
    user: { get: () => "", contact: () => Promise.resolve(undefined) },
    settings: {
      cms: { feedback: { text: (value?: string) => value === undefined ? draft : draft = value } },
      core: { lang_ns: { cms: () => "" } },
      "cms.frontend.4": { ui: { tree_show_c: () => false } },
    },
  } as unknown as Ctx;
  const app = await makeApp();
  setTransport(app, { send: () => Promise.resolve({ successful: false, errorMessages: ["refused"] }) });
  const node = { app };

  await assertRejects(
    () => requestStorage.run(ctx, () => more(node as never, { param: { msg: draft } })),
    Error,
    "CMS feedback could not be sent",
  );

  assertEquals(draft, "Please help");

  await close(app);
});
