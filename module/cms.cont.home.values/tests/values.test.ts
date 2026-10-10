import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Adapter } from "@qino/qino/home";

Deno.test("home values preserve types, escape output and isolate provider failures", async () => {
  let reads = 0;
  const provider: Adapter = {
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
  const row = (id: number) => ({ id, name: id === 1 ? "Healthy" : "Offline", adapter: id === 1 ? "healthy" : "offline", config: {}, enabled: true });
  const app = {
    t: fakeT,
    db: { query: () => Promise.resolve([row(1), row(2)]), row: (_strings: TemplateStringsArray, id: number) => Promise.resolve(row(id)) },
    modules: { linked: () => [provider, {
      ...provider, name: "offline", entities: () => Promise.reject(new Error("<offline>")),
    }].map((homeProvider) => ({ plugin: { homeProvider } })) },
  } as unknown as App;
  let selectedProvider = 0, selectedEntity = "";
  const node = { app, settings: { provider: () => selectedProvider, entity: () => selectedEntity } } as unknown as Node;
  const output = String(await cms.node.render(node));
  assertEquals(reads, 1);
  assertStringIncludes(output, "&lt;script&gt;bad()");
  assertStringIncludes(output, "false");
  assertStringIncludes(output, "Unavailable");
  assertStringIncludes(output, "&lt;/pre&gt;&lt;img src=x&gt;");
  assertStringIncludes(output, "&lt;offline&gt;");
  assertEquals(output.includes("<script>"), false);
  selectedProvider = 1;
  selectedEntity = "two";
  const selected = String(await cms.node.render(node));
  assertStringIncludes(selected, "Structured");
  assertEquals(selected.includes("bad()"), false);
  assertEquals(selected.includes("offline"), false);
  selectedEntity = "missing";
  assertStringIncludes(String(await cms.node.render(node)), "No entities were found.");
});
