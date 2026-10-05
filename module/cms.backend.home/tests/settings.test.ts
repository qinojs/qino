import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { provider } from "@qino/qino/home";

import api from "../nodeApi.ts";
import { settings } from "../settings.ts";
import { fixture } from "./fixture.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("home backend edits persisted instances and retains secrets", async () => {
  const { app, provider: id, close } = await fixture(), node = { app, id: 5 } as Node;
  try {
    const output = String(await settings(node));
    assertStringIncludes(output, 'value="http://house.test/"');
    assertStringIncludes(output, 'type="password"');
    assertStringIncludes(output, "<th>Name");
    assertStringIncludes(output, "<td>House</td>");
    assertStringIncludes(output, 'data-provider-enabled data-provider="1"');
    assertStringIncludes(output, "<summary>Edit</summary>");
    assertEquals(output.includes("saved-secret"), false);
    assertEquals((output.match(/class=u2-card/g) ?? []).length, 2);
    const edit = (config: Record<string, unknown>) => api(node, { config: { id, name: "House", adapter: "fake", config } });
    assertEquals(await edit({ url: "http://new.test/", accessToken: "" }), { ok: true, message: "Provider saved." });
    assertEquals((await provider(app, id)).config, { url: "http://new.test/", accessToken: "saved-secret" });
    for (const config of [{ unknown: true }, { accessToken: 123 }]) assertEquals((await edit(config) as { ok: boolean }).ok, false);
    assertEquals((await provider(app, id)).config.accessToken, "saved-secret");
  } finally { await close(); }
});
