import { assert, assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };
import { attachmentsOf } from "../nodeApi.ts";
import { backendDashboardWidget } from "../plugin.ts";
import { isSecret, leaves, send as sendForm, sending } from "../render.ts";

const { name, dependencies } = manifest;

const schema = {
  properties: {
    sender: { type: "string" },
    transport: {
      properties: {
        type: { type: "string", enum: ["", "smtp", "mock"] },
        smtp: { properties: { host: { type: "string" }, password: { type: "string" } } },
      },
    },
  },
};

Deno.test("cms.backend.superuser.messaging.email builds its form from the module's schema", async () => {
  assertEquals(name, "cms.backend.superuser.messaging.email");
  assertEquals(dependencies, ["cms.backend.superuser.messaging", "messaging.email", "cron"]);
  assertEquals(leaves(schema).map((leaf) => leaf.path), ["sender", "transport.type", "transport.smtp.host", "transport.smtp.password"]);
  assert(isSecret("transport.smtp.password") && isSecret("inbound.pass") && isSecret("transport.mailgun.apiKey"));
  assert(!isSecret("inbound.host"));

  const node = {
    app: {
      t: fakeT,
      dev: true,
      modules: { linked: () => ({ plugin: { settingsSchema: schema } }) },
      settings: {
        "messaging.email": {
          sender: "post@qino.test",
          inbound: {},
          transport: { type: "smtp", smtp: { host: "mail.qino.test", password: "private" } },
        },
      },
    },
  } as never;
  const output = String(await sending(node));
  assertStringIncludes(output, "post@qino.test");
  assertStringIncludes(output, "mail.qino.test");
  assertStringIncludes(output, 'name="transport.smtp.password"');
  assert(!output.includes("private"));
});

Deno.test("cms.backend.superuser.messaging.email adds files to the send form", async () => {
  const node = { app: { t: fakeT, db: { query: () => Promise.resolve([]) } } } as never;
  const output = String(await sendForm(node));
  assertStringIncludes(output, "<input type=file name=attachments multiple>");

  const [file] = await attachmentsOf([{
    name: "invoice.txt",
    type: "text/plain",
    content: "data:text/plain;base64,aW52b2ljZQ==",
  }]);
  assertEquals([file.name, file.type, await file.text()], ["invoice.txt", "text/plain", "invoice"]);
});

Deno.test("cms.backend.superuser.messaging.email dashboard uses portable traffic aliases", async () => {
  const queries: string[] = [];
  const app = {
    db: {
      row: (strings: TemplateStringsArray) => {
        const query = strings.join("?");
        queries.push(query);
        return Promise.resolve(query.includes("usr_contact")
          ? { n: 2, failing: 0 }
          : { outgoing: 3, incoming: 1 });
      },
      query: () => Promise.resolve([]),
    },
    t: fakeT,
  } as unknown as Parameters<typeof backendDashboardWidget>[0];

  const output = String(await backendDashboardWidget(app));
  assertStringIncludes(output, "3 sent");
  assert(queries.some((query) => query.includes("AS outgoing")));
  assert(!queries.some((query) => query.includes("AS out,")));
});
