// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

Deno.test("cms.layout.backend: finds the backend by its path", async () => {
  let path: string[] = [];
  const root = {
    children: () => new Map(),
    url: () => Promise.resolve("/de/backend"),
  };
  const page = {
    in: () => false,
    path: () => new Map([[1, {}]]),
  };
  const node = {
    app: {
      languages: { all: ["de"] },
    },
    cms: {
      nodeByPath: (value: string[]) => { path = value; return root; },
      link: () => Promise.resolve(""),
    },
    page: () => page,
    conts: () => [],
    cont: () => undefined,
  };
  const ctx = await testContext({ set: { lang: "de" } });

  const out = String(await cms.node.render(node as any, { ctx }));

  assertEquals(path, ["backend"]);
  assertEquals(out.includes('href="/de/backend"'), true);
});

Deno.test("cms.layout.backend: renders submenu indicators with u2-ico", async () => {
  const child = {
    children: () => new Map([[2, {}]]),
    conts: () => [],
    title: () => ({ string: () => "Parent" }),
    url: () => Promise.resolve("/de/backend/parent"),
  };
  const root = {
    children: () => new Map([[1, child]]),
    url: () => Promise.resolve("/de/backend"),
  };
  const page = {
    in: () => false,
    path: () => new Map([[1, {}]]),
  };
  const node = {
    app: {
      languages: { all: ["de"] },
      modules: { get: () => undefined },
    },
    cms: {
      nodeByPath: () => root,
      link: () => Promise.resolve(""),
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

Deno.test("cms.layout.backend: the active branch opens as deep as it goes", async () => {
  /** A page with one child, `depth` levels down. */
  const chain = (depth: number, name = "Level 1"): unknown => ({
    children: () => new Map(depth > 1 ? [[depth, chain(depth - 1, `Level ${5 - depth + 1}`)]] : []),
    conts: () => [],
    title: () => ({ string: () => name }),
    url: () => Promise.resolve(`/de/backend/${depth}`),
  });
  const root = { children: () => new Map([[1, chain(4)]]), url: () => Promise.resolve("/de/backend") };
  const node = {
    app: {
      languages: { all: ["de"] },
      modules: { get: () => undefined },
    },
    cms: { nodeByPath: () => root, link: () => Promise.resolve("") },
    page: () => ({ in: () => true, path: () => new Map() }),
    conts: () => [],
    cont: () => undefined,
  };
  const out = String(await cms.node.render(node as any, { ctx: await testContext({ set: { lang: "de" } }) }));
  for (const level of [1, 2, 3, 4]) assertEquals(out.includes(`style="--level:${level}"`), true, `level ${level}`);
});
