import { assertEquals, fakeCms } from "@qino/qino/tests";

import { init } from "../plugin.ts";

Deno.test("cms.frontend.ai1: loads the editor's assistant in editmode only", () => {
  let handler: (e: { ctx: unknown }) => void = () => {};
  const app = {};
  fakeCms(app, { on: (_: string, fn: typeof handler) => handler = fn });
  init(app as never, { signal: new AbortController().signal });
  const scripts: string[] = [];
  const page = (editmode: number) => ({
    req: { query: {}, moduleUrl: "/m/" },
    state: { cms: { editmode } },
    res: { html: { scripts: { add: (url: string) => scripts.push(url) } }, csp: { "script-src": {} } },
  });
  handler({ ctx: page(0) });
  assertEquals(scripts, []);
  handler({ ctx: page(1) });
  assertEquals(scripts, ["/m/cms.frontend.ai1/pub/rte.js"]);
});
