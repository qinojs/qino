import { assert, assertEquals, assertRejects } from "../../core/tests/deps.ts";
import { requestStorage, type RequestContext } from "../../core/mod.ts";
import more from "../view/widgets/more.ts";

Deno.test("cms.frontend.2 more: sends escaped feedback via app.mail", async () => {
  let draft = "draft";
  let values: Record<string, unknown> = {};
  let recipient = "";
  let sent = false;
  const ctx = {
    req: { header: (name: string) => name === "user-agent" ? "Test Browser" : undefined },
    requestUri: "/page",
    user: { get: (key: string) => ({ firstname: "Ada", lastname: "Lovelace", email: "ada@example.test" })[key as "firstname"] },
    settings: {
      cms: {
        feedback: { text: (value?: string) => value === undefined ? draft : draft = value },
      },
      core: { lang_ns: { cms: () => "" } },
      "cms.frontend.2": { custom: { tree_show_c: () => false } },
    },
  } as unknown as RequestContext;
  const app = {
    settings: { cms: { feedback: { email: "support@example.test" } } },
    languages: { all: [] },
    t: (strings: TemplateStringsArray) => strings[0],
    mail: {
      create: (data: Record<string, unknown>) => {
        values = data;
        return {
          addTo: (email: string) => recipient = email,
          send: () => { sent = true; return true; },
        };
      },
    },
  };
  const node = { app };

  const html = await requestStorage.run(ctx, () => more(node as never, {
    param: { msg: "<b>Hello</b>\nWorld", link: "https://example.test/?a=<b>" },
  }));

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
    requestUri: "/page",
    user: { get: () => "" },
    settings: {
      cms: { feedback: { text: (value?: string) => value === undefined ? draft : draft = value } },
      core: { lang_ns: { cms: () => "" } },
      "cms.frontend.2": { custom: { tree_show_c: () => false } },
    },
  } as unknown as RequestContext;
  const node = { app: {
    settings: { cms: { feedback: { email: "support@example.test" } } },
    mail: { create: () => ({ addTo: () => {}, send: () => false }) },
  } };

  await assertRejects(
    () => requestStorage.run(ctx, () => more(node as never, { param: { msg: draft } })),
    Error,
    "CMS feedback could not be sent",
  );

  assertEquals(draft, "Please help");
});
