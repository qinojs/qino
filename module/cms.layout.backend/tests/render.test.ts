// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "@qino/qino/tests";
import { cms } from "../plugin.ts";

Deno.test("cms.layout.backend: loads the backend id asynchronously", async () => {
  let id = 0;
  const backend = Promise.resolve("83");
  const root = {
    children: () => new Map(),
    url: () => "/de/backend",
  };
  const page = {
    in: () => false,
    path: () => new Map([[1, {}]]),
  };
  const node = {
    app: {
      settings: { cms: { backend } },
      languages: { all: ["de"] },
    },
    cms: {
      node: (value: number) => { id = value; return root; },
      link: () => "",
    },
    page: () => page,
    conts: () => [],
    cont: () => undefined,
  };
  const ctx = await testContext({ set: { lang: "de" } });

  const out = String(await cms.node.render(node as any, { ctx }));

  assertEquals(id, 83);
  assertEquals(out.includes('href="/de/backend"'), true);
});
