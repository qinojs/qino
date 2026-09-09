import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Emitter, Output } from "@qino/qino";
import { init } from "../plugin.ts";

import type { App, AppEvents, Ctx } from "@qino/qino";

Deno.test("serviceworker: asset revisions and mount paths invalidate script and ETag", async () => {
  const app = Object.assign(new Emitter<AppEvents>(), {
    assetRev: 1,
    modules: { linked: () => [{ name: "part", manifest: { files: ["pub/sw.js"] } }] },
  }) as unknown as App;
  init(app, { signal: new AbortController().signal });
  const request = async (base: string, etag = "") => {
    const raw = new Request("http://localhost" + base + "sw.js", { headers: { "If-None-Match": etag } });
    const ctx = { req: {
      appUrl: base, appPath: "sw.js", moduleUrl: `${base}m.${app.assetRev.toString(36)}/`,
      header: (name: string) => raw.headers.get(name),
    } } as unknown as Ctx;
    try {
      await app.fire("request-start", { request: raw, base, peerAddr: "", time: 0 });
      await app.fire("route", { ctx });
    } catch (e) {
      if (e instanceof Output) return e.toResponse();
      throw e;
    }
    throw new Error("Worker did not respond");
  };
  const first = await request("/one/");
  const etag = first.headers.get("etag")!;
  assertStringIncludes(await first.text(), 'import "/one/m.1/part/pub/sw.js"');
  assertEquals((await request("/one/", etag)).status, 304);
  app.assetRev = 2;
  const updated = await request("/one/", etag);
  assertEquals(updated.status, 200);
  assert(updated.headers.get("etag") !== etag);
  assertStringIncludes(await updated.text(), 'import "/one/m.2/part/pub/sw.js"');
  const mounted = await request("/two/", updated.headers.get("etag")!);
  assertEquals(mounted.status, 200);
  assertStringIncludes(await mounted.text(), 'import "/two/m.2/part/pub/sw.js"');
});
