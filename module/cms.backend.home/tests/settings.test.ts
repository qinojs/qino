import { requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";
import { provider } from "@qino/qino/home";

import api from "../nodeApi.ts";
import { settings } from "../settings.ts";
import { fixture } from "./fixture.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("home backend edits persisted instances and retains secrets through the protected API", async () => {
  const { app, provider: id, close } = await fixture(), node = { app, id: 5 } as Node;
  try {
    const user = await testContext({ app, set: { app, user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      const output = String(await settings(node));
      assertStringIncludes(output, 'value="http://house.test/"');
      assertStringIncludes(output, 'type="password"');
      assertEquals(output.includes("saved-secret"), false);
      assertEquals((output.match(/class=u2-card/g) ?? []).length, 2);
      assertEquals(await api(node, { config: { id, name: "House", adapter: "fake", url: "http://new.test/", config: { accessToken: "" } } }), { ok: true, message: "Provider saved." });
      assertEquals((await provider(app, id)).config.accessToken, "saved-secret");
      assertEquals((await provider(app, id)).url, "http://new.test/");
      for (const config of [{ unknown: true }, { accessToken: 123 }])
        assertEquals((await api(node, { config: { id, name: "House", adapter: "fake", url: "http://new.test/", config } }) as { ok: boolean }).ok, false);
      assertEquals((await provider(app, id)).config.accessToken, "saved-secret");
    });
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, async () => {
      assertEquals(await api(node, { config: { id, name: "House", adapter: "fake", url: "http://bad.test/" } }), { ok: false, message: "Access denied" });
    });
  } finally { await close(); }
});
