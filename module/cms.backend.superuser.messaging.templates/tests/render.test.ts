import { Db, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, contactDbSchema, fakeT, messagingDbSchema, templatePlaceholders, testContext } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };
import { overview, render, sampleValues } from "../render.ts";

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

Deno.test("the preview asks the modules themselves, so a template shows the real identity", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messagingDbSchema.properties, ...contactDbSchema.properties } });
  await db.loadTables();
  await db.table("message_template").insert({
    name: "letter",
    channel: "email",
    format: "html",
    text: `<h1>{{identity.brand}}</h1><p>Hallo {{givenName}}</p>{{content}}`,
  });
  const linked = [
    { name: "messaging", plugin: { messagingChannel: { name: "email", label: "Email" }, templatePlaceholders } },
    {
      name: "identity",
      plugin: {
        templatePlaceholders: {
          brand: () => ({ text: "Qino Demo", html: "Qino Demo" }),
        },
      },
    },
  ];
  const app = { db, t: fakeT, url: () => Promise.resolve("http://qino.test/"), settings: { core: { _secret: "test-secret" } }, modules: { linked: () => linked } };
  const ctx = await testContext({ url: "http://qino.test/backend/templates?name=letter&channel=email", app, set: { csrfToken: "test" } });

  const output = String(await requestStorage.run(ctx, () => render({ app } as never)));
  assertStringIncludes(output, "&lt;h1&gt;Qino Demo&lt;/h1&gt;"); // inside the preview iframe's srcdoc
  assertStringIncludes(output, "Hallo Ada");
  assertStringIncludes(output, `<code data-copy title="Click to copy">{{identity.brand}}</code>`); // whose it is, ready to paste
  await db.close();
});

Deno.test("template previews accept sync and async placeholders and isolate their failures", async () => {
  const app = { modules: { linked: () => [{ name: "example", plugin: { templatePlaceholders: {
    sync: () => ({ text: "sync" }),
    async: () => Promise.resolve({ text: "async" }),
    empty: () => undefined,
    throws: () => { throw new Error("No sample recipient"); },
    rejects: () => Promise.reject(new Error("Unavailable")),
  } } }] } };
  assertEquals(await sampleValues(app as never), {
    "example.sync": { text: "sync" }, "example.async": { text: "async" },
    "example.empty": { text: "" }, "example.throws": { text: "" }, "example.rejects": { text: "" },
  });
});
