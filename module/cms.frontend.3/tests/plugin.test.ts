import { assertEquals } from "@qino/qino/tests";

import { init } from "../plugin.ts";

import type { App } from "@qino/qino";

function setup(editmode: number) {
  let listener: (e: Record<string, unknown>) => Promise<void> = null!;
  const app = {
    on: (_name: string, fn: typeof listener) => listener = fn,
    settings: { cms: { frontend: "cms.frontend.3" } },
  };
  init(app as unknown as App, { signal: new AbortController().signal });

  const scripts = new Set<string>();
  const styles = new Set<string>();
  const jsData: { qino?: { cms?: { nodeId?: number; requestedNodeId?: number; editmode?: number; clipboard?: number } } } = {};
  const ctx = {
    req: { query: {}, moduleUrl: "/site/m/" },
    settings: { cms: { clipboard: () => "13" } },
    state: { cms: {
      mainNode: { id: 42, access: () => 2 },
      requestedNodeId: 7,
      editmode,
    } },
    res: { html: { jsData, scripts, styles } },
  };
  return { ctx, jsData, listener, scripts, styles };
}

Deno.test("cms.frontend.3: exposes its small browser entry", async () => {
  const { ctx, jsData, listener, scripts, styles } = setup(0);
  await listener({ ctx });

  assertEquals(jsData.qino?.cms, { nodeId: 42, requestedNodeId: 7, editmode: 0 });
  assertEquals([...scripts], ["/site/m/cms.frontend.3/pub/init.js"]);
  assertEquals([...styles], ["/site/m/cms.frontend.3/pub/init.css"]);
});

Deno.test("cms.frontend.3: lets the browser build the panel in edit mode", async () => {
  const { ctx, jsData, listener, scripts, styles } = setup(1);
  await listener({ ctx });

  assertEquals(jsData.qino?.cms?.clipboard, 13);
  assertEquals([...scripts], [
    "/site/m/cms.frontend.3/pub/js/frontend.mjs",
    "/site/m/cms.frontend.3/pub/init.js",
  ]);
  assertEquals([...styles], [
    "/site/m/cms.frontend.3/pub/init.css",
    "/site/m/cms.frontend.3/pub/frontend.css",
  ]);
});
