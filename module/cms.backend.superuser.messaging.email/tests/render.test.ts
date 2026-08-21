import { assert, assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };
import { attachmentsOf } from "../nodeApi.ts";
import { backendDashboardWidget } from "../plugin.ts";
import { isSecret, leaves, send as sendForm, sending } from "../render.ts";

const { name, dependencies } = manifest;

const schema = {
  properties: {
    address: { type: "string" },
    name: { type: "string", advanced: true },
    debugTo: { type: "string", advanced: true },
    transport: {
      properties: {
        type: { type: "string", enum: ["smtp", "mock"], default: "smtp" },
        smtp: { properties: {
          host: { type: "string" }, secure: { type: "boolean", advanced: true, default: true }, pass: { type: "string" },
        } },
        mock: { properties: { result: { type: "string" } } },
      },
    },
  },
};

Deno.test("cms.backend.superuser.messaging.email builds its form from the module's schema", async () => {
  assertEquals(name, "cms.backend.superuser.messaging.email");
  assertEquals(dependencies, ["cms.backend.superuser.messaging", "messaging.email", "cron"]);
  assertEquals(leaves(schema).map((leaf) => leaf.path), ["address", "name", "debugTo", "transport.type", "transport.smtp.host", "transport.smtp.secure", "transport.smtp.pass", "transport.mock.result"]);
  assert(isSecret("transport.smtp.pass") && isSecret("inbound.pass") && isSecret("transport.mailgun.apiKey"));
  assert(!isSecret("inbound.host"));

  const node = {
    app: {
      t: fakeT,
      dev: true,
      modules: { linked: () => ({ plugin: { settingsSchema: schema } }) },
      settings: {
        "messaging.email": {
          address: "post@qino.test",
          inbound: {},
          transport: { smtp: { host: "mail.qino.test", pass: "private" }, mock: {} },
        },
      },
    },
  } as never;
  const output = String(await sending(node));
  assertStringIncludes(output, "post@qino.test");
  assertStringIncludes(output, "mail.qino.test");
  assertStringIncludes(output, '<div class="u2-table -Fields">');
  assertEquals(output.match(/<div class="u2-table -Fields">/g)?.length, 2);
  assertStringIncludes(output, '<label><span>address</span><span><input name="address"');
  assertStringIncludes(output, 'data-transport-fields="mock" hidden style="display:none"');
  assert(!output.includes("<u2-fields>"));
  assertStringIncludes(output, 'name="transport.smtp.pass"');
  const advanced = output.indexOf("<details>");
  assert(output.indexOf('name="transport.smtp.host"') < advanced);
  assert(output.indexOf('name="name"') > advanced);
  assert(output.indexOf('name="debugTo"') > advanced);
  assertStringIncludes(output.slice(advanced), '<option value="smtp" selected>smtp</option>');
  assert(output.indexOf('name="transport.smtp.secure"') > advanced);
  assertStringIncludes(output.slice(advanced), 'name="transport.smtp.secure" title="" checked');
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
