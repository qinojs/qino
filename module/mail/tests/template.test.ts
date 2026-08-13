import { assertEquals, assertStringIncludes } from "@std/assert";
import type { App } from "@qino/qino";
import { MailManager } from "../lib/MailManager.ts";

Deno.test("string mail template inserts main as HTML and escapes data markers", async () => {
  const app = {} as App;
  const manager = new MailManager(app);
  manager.template("custom", `<h1>{{ title }}</h1><main>{{main}}</main>`);
  const mail = manager.build({
    html: `<p>Hello {{name}}</p>`,
    data: { name: `<Admin>`, title: `<img src=x onerror=alert(1)>` },
    template: "custom",
  });

  assertEquals(
    await mail.getHtml(undefined, mail.data),
    `<h1>&lt;img src=x onerror=alert(1)&gt;</h1><main><p>Hello &lt;Admin&gt;</p></main>`,
  );
});

Deno.test("text mail becomes safe HTML when it uses a template", async () => {
  const app = {} as App;
  const manager = new MailManager(app);
  manager.template("custom", `<header>Header</header><main>{{main}}</main>`);
  const mail = manager.build({
    text: `Hello <Admin>\nOpen {{url}}`,
    data: { url: `https://example.test/?a=1&b=2` },
    template: "custom",
  });

  assertEquals(
    await mail.getHtml(undefined, mail.data),
    `<header>Header</header><main>Hello &lt;Admin&gt;<br>\nOpen https://example.test/?a=1&amp;b=2</main>`,
  );
});

Deno.test("sending a text mail applies its HTML template", async () => {
  const app = {
    settings: { mail: { sender: "sender@example.test", sendername: "", reply_to: "", debug_to: "", base_url: "" } },
  } as unknown as App;
  const manager = new MailManager(app);
  let delivered: unknown;
  manager
    .template("custom", `<header>Header</header><main>{{main}}</main>`)
    .setTransport({
      send(message: unknown): Promise<unknown> {
        delivered = message;
        return Promise.resolve({ successful: true });
      },
    });
  const mail = manager.build({
    to: "receiver@example.test",
    text: "Plain text",
    template: "custom",
  });

  assertEquals(await mail.send(), true);
  assertStringIncludes(JSON.stringify(delivered), `<header>Header</header><main>Plain text</main>`);
});
