import { App, runAs, unixTime } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { cms, list } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.user_memory: what agents keep about users, to remove", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "ai1.tools", "cron", "score", "ai1.embed", "ai1.agent", "ai1.user_memory"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const id = await app.db.table("ai1_user_memory").insert({ usr_id: 7, content: "always <b>German</b>", time: unixTime() });
    const node = { app } as unknown as Node;
    const page = String(await runAs(app, 7, "test", () => list(node)));
    for (const part of ["ann@example.test", `[u${id}] always &lt;b&gt;German&lt;/b&gt;`, `data-remove="${id}"`]) assertStringIncludes(page, part);
    assertEquals(await cms.node.api(node, { remove: id }), { ok: true });
    assertEquals(await app.db.col`SELECT id FROM ai1_user_memory`, []);
    assertStringIncludes(String((await cms.node.api(node, { decide: "always German" }) as { message: string }).message), "No model"); // none here: told, not thrown
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
