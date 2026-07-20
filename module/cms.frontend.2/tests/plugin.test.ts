import { assertEquals } from "../../core/tests/deps.ts";
import type { App } from "../../core/mod.ts";
import { init } from "../plugin.ts";

Deno.test("cms.frontend.2: stores request URI without base path", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  let stored = "";
  const app = {
    on: (_name: string, fn: typeof listener) => listener = fn,
    settings: { cms: { frontend: "cms.frontend.2", pageNotFound: 0 } },
  };
  init(app as unknown as App, { signal: new AbortController().signal });

  const jsData: { qino?: { cms?: { beUrl?: string } } } = {};
  const ctx = {
    req: {
      appPath: "backend/page",
      basePath: "/cms1/",
      modulePath: "/cms1/m/",
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

Deno.test("cms.frontend.2: exposes stored app path unchanged", async () => {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  const app = {
    on: (_name: string, fn: typeof listener) => listener = fn,
    settings: { cms: { frontend: "cms.frontend.2", pageNotFound: 0 } },
  };
  init(app as unknown as App, { signal: new AbortController().signal });

  const jsData: { qino?: { cms?: { beUrl?: string } } } = {};
  const ctx = {
    req: {
      appPath: "backend/page",
      basePath: "/cms1/",
      modulePath: "/cms1/m/",
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
