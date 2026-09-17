import { App } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Ctx } from "@qino/qino";

Deno.test("cms.backend.superuser.security lists suspicious IPs and releases them", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("security");
  await app.init();
  try {
    await app.db.table("log_ip").insert({ ip: "6.6.6.6" });
    const ctx = { app, req: { clientIp: "6.6.6.6" } } as unknown as Ctx;
    await app.fire("suspicious", { ctx, weight: 60, reason: "test <probe>" });
    await app.fire("suspicious", { ctx, weight: 2, reason: "second" });

    app.t = ((strings: TemplateStringsArray) => Promise.resolve(strings.join(""))) as App["t"];
    const page = { url: () => Promise.resolve("/backend/log?cmspid=9") };
    const node = { app, cms: { nodeByModule: () => Promise.resolve({ page: () => Promise.resolve(page) }) } } as never;
    const opts = { ctx: { req: { url: new URL("https://qino.test/") } } } as never;
    const out = String(await cms.node.parts.recent(node, opts)) + String(await cms.node.parts.suspects(node, opts));
    assertStringIncludes(out, `<a href="https://qino.test/backend/log?cmspid=9&amp;search=6.6.6.6"><code>6.6.6.6</code></a>`);
    assertStringIncludes(out, ">blocked</span>");
    assertStringIncludes(out, "test &lt;probe&gt;");
    assertEquals(out.indexOf("second") < out.indexOf("test &lt;probe"), true);

    const res = await cms.node.api(node, { release: "6.6.6.6" }) as { ok: boolean };
    assertEquals(res.ok, true);
    assertStringIncludes(String(await cms.node.parts.suspects(node, opts)), "No suspicious IPs.");
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM score`), 0);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
