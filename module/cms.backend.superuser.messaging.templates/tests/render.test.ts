import { Db, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, messagingDbSchema, testContext } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };
import { overview } from "../render.ts";

const { name, dependencies } = manifest;

Deno.test("cms.backend.superuser.messaging.templates lists the frames and names the channels without one", async () => {
  assertEquals(name, "cms.backend.superuser.messaging.templates");
  assertEquals(dependencies, ["cms.backend.superuser.messaging", "messaging"]);

  const db = new Db("sqlite::memory:");
  await db.migrate(messagingDbSchema);
  await db.loadTables();
  await db.table("message_template").insert({ name: "signature", channel: "sms", main: true, text: "{{content}}\nbye" });
  const linked = [
    { plugin: { messagingChannel: { name: "sms", label: "SMS" } } },
    { plugin: { messagingChannel: { name: "email", label: "Email" } } },
  ];
  const app = { db, t: fakeT, modules: { linked: () => linked } };
  const ctx = await testContext({ url: "http://qino.test/backend/templates", app, set: { csrfToken: "test" } });

  const output = String(await requestStorage.run(ctx, () => overview({ app } as never)));
  assertStringIncludes(output, "?name=signature&amp;channel=sms");
  assertStringIncludes(output, "<span class=u2-badge>Email</span>"); // email has no default yet
  await db.close();
});
