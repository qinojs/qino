import { requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { list, renderActions, renderEntities } from "../render.ts";
import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { save } from "@qino/qino/home";
import { fixture } from "./fixture.ts";

const entity = { id: "sensor.temp", name: "Temperature", state: 21.5, attributes: { unit: "°C" }, available: true };
const appOf = () => ({ t: fakeT }) as unknown as App;

Deno.test("home backend renders observations and action metadata safely without device-specific assumptions", async () => {
  const app = appOf();
  const output = String(await renderEntities(app, [{
    ...entity, name: '<img src=x onerror="attack()">', state: false, available: false,
    attributes: { note: "</pre><script>attack()</script>" },
  }]));
  assertStringIncludes(output, "&lt;img");
  assertStringIncludes(output, "&lt;/pre&gt;&lt;script&gt;");
  assertStringIncludes(output, "false");
  assertStringIncludes(output, "Unavailable");
  assertEquals(output.includes("<script>"), false);
  const form = String(await renderActions(app, 1, [{
    id: 'a" onclick="attack()', name: "<b>Action</b>", fields: { value: "</option><script>attack()</script>" },
  }], [entity]));
  assertStringIncludes(form, 'data-provider="1"');
  assertStringIncludes(form, "&lt;b&gt;Action&lt;/b&gt;");
  assertEquals(form.includes("<script>"), false);
  assertStringIncludes(form, "<option value=\"\">Select an action</option>");
});

Deno.test("home backend keeps healthy provider instances visible when another fails", async () => {
  const { app, close } = await fixture();
  try {
    await save(app, { name: "Offline", adapter: "fake", url: "http://offline.test/" });
    const output = String(await list({ app } as Node));
    assertStringIncludes(output, "&lt;offline&gt;");
    assertStringIncludes(output, "sensor.temp");
    assertStringIncludes(output, 'data-provider="1"');
    assertStringIncludes(output, 'data-provider="2"');
    assertEquals(cms.node.parts.list, list);
  } finally { await close(); }
});

Deno.test("home backend commands use real home API validation and access checks", async () => {
  const { app, provider, close } = await fixture(), node = { app } as Node;
  try {
    const ctx = await testContext({ app, set: { app, user: { id: 7 } } });
    await requestStorage.run(ctx, async () => {
      assertEquals(await api(node, {}), false);
      const result = await api(node, { provider, action: "set", entities: [entity.id], data: { value: true } }) as { ok: boolean; result: unknown };
      assertEquals(result.ok, true);
      assertEquals(result.result, { action: "set", input: { entities: [entity.id], data: { value: true } } });
      for (const input of [{ provider, action: "set", data: [] }, { provider, action: "set", entities: "bad" }, { action: "set" }])
        assertEquals((await api(node, input) as { ok: boolean }).ok, false);
    });
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, async () => {
      assertEquals(await api(node, { provider, action: "set" }), { ok: false, message: "Access denied" });
    });
  } finally { await close(); }
});
