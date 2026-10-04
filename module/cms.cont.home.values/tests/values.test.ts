import { App, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";
import type { Provider } from "@qino/qino/home";

Deno.test("home values enforce user access, preserve types and isolate provider failures", async () => {
  const dir = await Deno.makeTempDir(), app = new App({ dir, db: "sqlite::memory:" });
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  let reads = 0;
  const provider: Provider = {
    name: "healthy",
    entities: () => {
      reads++;
      return Promise.resolve([
        { id: "one", name: "<script>bad()</script>", state: false, attributes: {}, available: false },
        { id: "two", name: "Structured", state: { note: "</pre><img src=x>" }, attributes: {}, available: true },
      ]);
    },
    actions: () => Promise.resolve([]),
    call: () => Promise.reject(new Error("Read only")),
  };
  const source = {
    modules: { linked: () => [provider, {
      ...provider, name: "offline", entities: () => Promise.reject(new Error("<offline>")),
    }].map((homeProvider) => ({ plugin: { homeProvider } })) },
  } as unknown as App;
  let selectedProvider = "", selectedEntity = "";
  const node = {
    app,
    settings: { provider: () => selectedProvider, entity: () => selectedEntity },
  } as unknown as Node;
  try {
    await app.init();
    app.t = fakeT;
    const guest = await testContext({ app: source });
    await requestStorage.run(guest, async () => {
      assertStringIncludes(String(await cms.node.render(node)), "Access denied");
      selectedProvider = "healthy";
      assertStringIncludes(String(await cms.node.render(node)), "Access denied");
      assertEquals(reads, 0);
      selectedProvider = "";
    });
    const user = await testContext({ app: source, set: { user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      const output = String(await cms.node.render(node));
      assertStringIncludes(output, "&lt;script&gt;bad()");
      assertStringIncludes(output, "false");
      assertStringIncludes(output, "Unavailable");
      assertStringIncludes(output, "&lt;/pre&gt;&lt;img src=x&gt;");
      assertStringIncludes(output, "&lt;offline&gt;");
      assertEquals(output.includes("<script>"), false);
      selectedProvider = "healthy";
      selectedEntity = "two";
      const selected = String(await cms.node.render(node));
      assertStringIncludes(selected, "Structured");
      assertEquals(selected.includes("bad()"), false);
      assertEquals(selected.includes("offline"), false);
      selectedEntity = "missing";
      assertStringIncludes(String(await cms.node.render(node)), "No entities were found.");
    });
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
