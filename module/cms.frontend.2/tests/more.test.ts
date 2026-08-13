import { requestStorage } from "@qino/qino";
import { assert, assertEquals, assertRejects, fakeMail } from "@qino/qino/tests";

import more from "../view/widgets/more.ts";

import type { Ctx } from "@qino/qino";

Deno.test("cms.frontend.2 more: sends escaped feedback via app.mail", async () => {
  let draft = "draft";
  let values: Record<string, unknown> = {};
  let recipient = "";
  let sent = false;
  const ctx = {
    req: { header: (name: string) => name === "user-agent" ? "Test Browser" : undefined },
    user: { firstname: "Ada", lastname: "Lovelace", email: "ada@example.test" },
    settings: {
      cms: {
        feedback: { text: (value?: string) => value === undefined ? draft : draft = value },
      },
      core: { lang_ns: { cms: () => "" } },
      "cms.frontend.2": { ui: { tree_show_c: () => false } },
    },
  } as unknown as Ctx;
  const app = {
    settings: { cms: { feedback: { email: "support@example.test" } } },
    languages: { all: [] },
    t: (strings: TemplateStringsArray) => strings[0],
  };
  fakeMail(app, {
    create: (data: Record<string, unknown>) => {
      values = data;
      return {
        addTo: (email: string) => recipient = email,
        send: () => { sent = true; return true; },
      };
    },
  } as never);
  const node = { app };

  const html = String(await requestStorage.run(ctx, () => more(node as never, {
    param: { msg: "<b>Hello</b>\nWorld", link: "https://example.test/?a=<b>" },
  })));

  assertEquals(recipient, "support@example.test");
  assertEquals(sent, true);
  assertEquals(draft, "");
  assertEquals(values.subject, "CMS feedback");
  assertEquals(values.replyTo, "ada@example.test");
  assert(String(values.html).includes("&lt;b&gt;Hello&lt;/b&gt;<br>World"));
  assert(html.includes("Thank you for your feedback."));
  assert(html.includes("class=-tour"));
});

Deno.test("cms.frontend.2 more: keeps feedback draft when sending fails", async () => {
  let draft = "Please help";
  const ctx = {
    req: { header: () => undefined },
    user: { get: () => "" },
    settings: {
      cms: { feedback: { text: (value?: string) => value === undefined ? draft : draft = value } },
      core: { lang_ns: { cms: () => "" } },
      "cms.frontend.2": { ui: { tree_show_c: () => false } },
    },
  } as unknown as Ctx;
  const app = { settings: { cms: { feedback: { email: "support@example.test" } } } };
  fakeMail(app, { create: () => ({ addTo: () => {}, send: () => false }) } as never);
  const node = { app };

  await assertRejects(
    () => requestStorage.run(ctx, () => more(node as never, { param: { msg: draft } })),
    Error,
    "CMS feedback could not be sent",
  );

  assertEquals(draft, "Please help");
});
