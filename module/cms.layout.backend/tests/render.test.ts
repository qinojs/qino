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

Deno.test("cms.layout.backend: renders submenu indicators with u2-ico", async () => {
  const child = {
    children: () => new Map([[2, {}]]),
    conts: () => [],
    title: () => ({ string: () => "Parent" }),
    url: () => "/de/backend/parent",
  };
  const root = {
    children: () => new Map([[1, child]]),
    url: () => "/de/backend",
  };
  const page = {
    in: () => false,
    path: () => new Map([[1, {}]]),
  };
  const node = {
    app: {
      settings: { cms: { backend: 83 } },
      languages: { all: ["de"] },
      modules: { get: () => undefined },
    },
    cms: {
      node: () => root,
      link: () => "",
    },
    page: () => page,
    conts: () => [],
    cont: () => undefined,
  };
  const ctx = await testContext({ set: { lang: "de" } });

  const out = String(await cms.node.render(node as any, { ctx }));

  assertEquals(out.includes('<u2-ico class=-subIcon icon="expand_more" aria-hidden=true>⌄</u2-ico>'), true);
  assertEquals([...ctx.res.html.scripts].some((src) => src.endsWith("/el/ico/ico.js")), true);
  assertEquals([...ctx.res.html.styles].some((src) => src.endsWith("/cms/pub/css/ui.css")), true);
  assertEquals(ctx.res.csp["connect-src"]["https://cdn.jsdelivr.net/npm/@material-icons/svg@1.0.33/"], undefined);
});
