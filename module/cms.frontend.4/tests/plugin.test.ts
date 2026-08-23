import { assertEquals } from "@qino/qino/tests";

import { init } from "../plugin.ts";

import type { App } from "@qino/qino";

Deno.test("cms.frontend.4: stores request URI without base path", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  let stored = "";
  const app = {
    on: (_name: string, fn: typeof listener) => listener = fn,
    settings: { cms: { frontend: "cms.frontend.4", pageNotFound: 0 } },
  };
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
    on: (_name: string, fn: typeof listener) => listener = fn,
    settings: { cms: { frontend: "cms.frontend.4", pageNotFound: 0 } },
  };
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
