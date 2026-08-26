import { Db, invoke, requestStorage } from "@qino/qino";
import { setTransport } from "@qino/qino/messaging.email";
import { assert, assertEquals, assertRejects, contactDbSchema, DbFileManager, fakeT, fileDbSchema, messagingDbSchema } from "@qino/qino/tests";

import { api } from "../plugin.ts";

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
      core: { _secret: "test-secret" },
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

/** The panel's context: a logged-in user and the feedback draft in the session. */
function makeCtx(app: App, draft: { value: string }, user: Record<string, unknown>): Ctx {
  return {
    app,
    req: { header: (name: string) => name === "user-agent" ? "Test Browser" : undefined },
    user,
    settings: { cms: { feedback: { text: (value?: string) => value === undefined ? draft.value : draft.value = value } } },
  } as unknown as Ctx;
}

async function close(app: App): Promise<void> {
  await app.db.close();
  await Deno.remove(app.dir, { recursive: true });
}

Deno.test("cms.frontend.4 feedback: sends escaped feedback over the email channel", async () => {
  const app = await makeApp();
  const draft = { value: "draft" };
  const ctx = makeCtx(app, draft, {
    given_name: "Ada",
    family_name: "Lovelace",
    superuser: true,
    contact: () => Promise.resolve("ada@example.test"),
  });
  const posted: Record<string, unknown>[] = [];
  setTransport(app, { send: (message) => (posted.push(message as Record<string, unknown>), Promise.resolve({ successful: true })) });

  await requestStorage.run(ctx, () => invoke(api, "POST", "/feedback", {
    msg: "<b>Hello</b>\nWorld",
    link: "https://example.test/?a=<b>",
  }));

  assertEquals(String((posted[0].recipients as { address: string }[])[0].address), "support@example.test");
  assertEquals(String((posted[0].replyRecipients as { address: string }[])[0].address), "ada@example.test");
  assertEquals(String(posted[0].subject), "CMS feedback");
  assertEquals(draft.value, "");
  assert(String((posted[0].content as { html: string }).html).includes("&lt;b&gt;Hello&lt;/b&gt;<br>World"));

  await close(app);
});

Deno.test("cms.frontend.4 feedback: keeps the draft when sending fails", async () => {
  const app = await makeApp();
  const draft = { value: "Please help" };
  const ctx = makeCtx(app, draft, { superuser: true, contact: () => Promise.resolve(undefined) });
  setTransport(app, { send: () => Promise.resolve({ successful: false, errorMessages: ["refused"] }) });

  await assertRejects(
    () => requestStorage.run(ctx, () => invoke(api, "POST", "/feedback", { msg: draft.value })),
    Error,
    "CMS feedback could not be sent",
  );

  assertEquals(draft.value, "Please help");

  await close(app);
});
