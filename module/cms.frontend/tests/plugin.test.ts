import { test } from "node:test";
import { fs, invoke, requestStorage, unixTime } from "@qino/qino";
import { assertEquals, fakeCms } from "@qino/qino/tests";

import { api, init } from "../plugin.ts";

import type { App, Ctx } from "@qino/qino";

test("cms.frontend: repeated file creation advances the asset revision", async () => {
  const dir = await fs.tempDir() + "/";
  const app = { assetRev: unixTime() + 10 };
  fakeCms(app, { node: () => ({ module: { data: dir } }) });
  const ctx = { app, user: { superuser: true } } as unknown as Ctx;
  const create = (path: string) => requestStorage.run(ctx, () =>
    invoke(api, "POST", "/files/7", { in: "data", path }));
  try {
    const initial = app.assetRev;
    assertEquals(await create("pub/first.css"), { ok: true });
    assertEquals(app.assetRev, initial + 1);
    assertEquals(await create("pub/second.css"), { ok: true });
    assertEquals(app.assetRev, initial + 2);
    assertEquals(await fs.text(dir + "pub/second.css"), "");
  } finally {
    await fs.remove(dir, { recursive: true });
  }
});

test("cms.frontend: stores request URI without base path", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  let stored = "";
  const app = {
    settings: { cms: { frontend: "cms.frontend" } },
  };
  fakeCms(app, { on: (_name: string, fn: typeof listener) => listener = fn, nodeByPath: () => undefined });
  init(app as unknown as App, { signal: new AbortController().signal });

  const jsData: { qino?: { cms?: { beUrl?: string } } } = {};
  const ctx = {
    req: {
      appPath: "backend/page",
      appUrl: "/cms1/",
      moduleUrl: "/cms1/m/",
      url: new URL("https://example.test/cms1/backend/page?tab=settings"),
      query: {},
    },
    state: { cms: { mainNode: { id: 1, vs: { module: "cms.layout.backend" }, access: () => 1 } } },
    res: { html: { jsData, scripts: { add: () => {} } } },
    settings: { cms: {
      last_backend_page: (value: string) => stored = value,
      last_frontend_page: () => "frontend/page",
    } },
  };

  await listener({ ctx });

  assertEquals(stored, "backend/page?tab=settings");
  assertEquals(jsData.qino?.cms?.beUrl, "frontend/page");
});

test("cms.frontend: exposes stored app path unchanged", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  const app = {
    settings: { cms: { frontend: "cms.frontend" } },
  };
  fakeCms(app, { on: (_name: string, fn: typeof listener) => listener = fn, nodeByPath: () => undefined });
  init(app as unknown as App, { signal: new AbortController().signal });

  const jsData: { qino?: { cms?: { beUrl?: string } } } = {};
  const ctx = {
    req: {
      appPath: "backend/page",
      appUrl: "/cms1/",
      moduleUrl: "/cms1/m/",
      url: new URL("https://example.test/cms1/backend/page"),
      query: {},
    },
    state: { cms: { mainNode: { id: 1, vs: { module: "cms.layout.backend" }, access: () => 1 } } },
    res: { html: { jsData, scripts: { add: () => {} } } },
    settings: { cms: {
      last_backend_page: () => {},
      last_frontend_page: () => "////frontend/page",
    } },
  };

  await listener({ ctx });

  assertEquals(jsData.qino?.cms?.beUrl, "////frontend/page");
});

test("cms.frontend: backend pages that edit a node give the panel a link each", async () => {
  const node = { id: 7, access: () => 2 };
  const page = (access: number) => ({ page: async () => ({ access: () => access, url: () => "/de/backend/events?cmspid=9" }) });
  const pages: Record<string, ReturnType<typeof page>> = { "cms.backend.event": page(1), "cms.backend.hidden": page(0) };
  const edit = (title: string) => () => Promise.resolve(title);
  const app = { modules: { linked: () => [
    { name: "cms.backend.event", plugin: { backendEdit: edit("Edit event in the backend") } },
    { name: "cms.backend.hidden", plugin: { backendEdit: edit("Not allowed") } },
    { name: "cms.backend.none", plugin: { backendEdit: () => Promise.resolve(undefined) } },
    { name: "cms.text", plugin: {} },
  ] } };
  fakeCms(app, { node: () => node, nodeByModule: (name: string) => pages[name] });
  const ctx = { app, user: { id: 1 }, userId: 1, req: { url: new URL("http://qino.test/de/x") } } as unknown as Ctx;
  // the backend page keeps its own query and gets the module's parameters
  assertEquals(await requestStorage.run(ctx, () => invoke(api, "GET", "/edits/7")), [
    { title: "Edit event in the backend", url: "/de/backend/events?cmspid=9&id=7" },
  ]);
});
