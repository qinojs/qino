import { App, runAs, unixTime } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { cms, list, memories, sessions, users } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.user_memory: what agents keep about users, to remove", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "ai1.tools", "cron", "score", "ai1.embed", "ai1.discover", "ai1.agent", "ai1.user_memory"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const id = await app.db.table("ai1_user_memory").insert({ usr_id: 7, content: "always <b>German</b>", time: unixTime() });
    const node = { app, page: () => ({ url: () => "/memories" }), cms: { nodeByModule: () => undefined } } as unknown as Node;
    const as = (fn: () => Promise<unknown>) => runAs(app, 7, "test", fn).then(String);
    const page = await as(() => list(node));
    for (const part of ["ann@example.test", `<td>${id}`, "always &lt;b&gt;German&lt;/b&gt;", `data-remove="${id}"`]) assertStringIncludes(page, part);
    for (const part of ['href="/memories?usr=7"', "ann@example.test"]) assertStringIncludes(await as(() => users(node)), part);
    // a user's page: their memories, in context and how strong, and their sessions
    const theirs = await as(() => memories(node, { vars: { usr: 7 } }));
    for (const part of ["always &lt;b&gt;German&lt;/b&gt;", "<td>✓", `data-remove="${id}"`]) assertStringIncludes(theirs, part);
    assertStringIncludes(await as(() => sessions(node, { vars: { usr: 7 } })), "No sessions yet");
    assertEquals(await cms.node.api(node, { remove: id }), { ok: true });
    assertEquals(await app.db.col`SELECT id FROM ai1_user_memory`, []);
    assertStringIncludes(String((await cms.node.api(node, { decide: "always German" }) as { message: string }).message), "No model"); // none here: told, not thrown
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
