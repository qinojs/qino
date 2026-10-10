import { fs, invoke, requestStorage, unixTime } from "@qino/qino";
import { assertEquals, fakeCms } from "@qino/qino/tests";

import { api, init } from "../plugin.ts";

import type { App, Ctx } from "@qino/qino";

Deno.test("cms.frontend.4: repeated file creation advances the asset revision", async () => {
  const dir = await Deno.makeTempDir() + "/";
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
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.frontend.4: stores request URI without base path", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  let stored = "";
  const app = {
    settings: { cms: { frontend: "cms.frontend.4", pageNotFound: 0 } },
  };
  fakeCms(app, { on: (_name: string, fn: typeof listener) => listener = fn });
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

Deno.test("cms.frontend.4: exposes stored app path unchanged", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  const app = {
    settings: { cms: { frontend: "cms.frontend.4", pageNotFound: 0 } },
  };
  fakeCms(app, { on: (_name: string, fn: typeof listener) => listener = fn });
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
