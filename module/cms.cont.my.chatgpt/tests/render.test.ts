import { App } from "@qino/qino";
import { assertStringIncludes } from "@qino/qino/tests";
import { store } from "@qino/m/ai1.chatgpt/tests/deps.ts";

import { cms } from "../plugin.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

Deno.test("ChatGPT account content node renders a return link and escapes account labels", async () => {
  const dir = await Deno.makeTempDir();
  const original = globalThis.fetch;
  const app = new App({ db: "sqlite::memory:", dir: dir + "/" });
  const source = app.stores.add(new URL("../../store.json", import.meta.url));
  const viewApp = { modules: app.modules, db: app.db, t: (strings: TemplateStringsArray) => Promise.resolve(strings[0]) } as unknown as App;
  const node = { app: viewApp } as Node;
  const headers = new Headers();
  const ctx = { user: {}, userId: 7, csrfToken: "csrf", res: { headers }, req: {
    appUrl: "/cms1/", url: new URL("http://127.0.0.1:8080/cms1/account") },
  } as unknown as Ctx;
  try {
    await app.init();
    await source.install("ai1.chatgpt");
    await store(viewApp, 7, { client_id: "oaiapp_test", subject: "sub", email: "<script>alert(1)</script>",
      id_token: "", access_token: "token", refresh_token: "refresh", scopes: ["chatgpt.tokens.use.direct"],
      expires_at: Date.now() + 3600_000 });
    globalThis.fetch = () => Promise.resolve(Response.json({ models: [{ slug: "gpt-test", visibility: "list" }] }));
    const output = String(await cms.node.render(node, { ctx }));
    assertStringIncludes(output, "/cms1/ai1-chatgpt/start?return_to=%2Fcms1%2Faccount");
    assertStringIncludes(output, "&lt;script&gt;alert(1)&lt;/script&gt;");
    assertStringIncludes(output, "gpt-test");
    assertStringIncludes(output, 'name=return_to value="/cms1/account"');
    assertStringIncludes(headers.get("Cache-Control") ?? "", "no-store");
  } finally { globalThis.fetch = original; await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
