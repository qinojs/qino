import { App, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { list, renderActions, renderEntities } from "../render.ts";
import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";
import type { Provider } from "@qino/qino/home";

const entity = { id: "sensor.temp", name: "Temperature", state: 21.5, attributes: { unit: "°C" }, available: true };
const provider: Provider = {
  name: "other",
  entities: () => Promise.resolve([entity]),
  actions: () => Promise.resolve([{ id: "set", name: "Set", fields: { value: { required: true } } }]),
  call: (_app, action, input) => Promise.resolve({ action, input }),
};
const appOf = (...providers: Provider[]) => ({
  t: fakeT,
  modules: { linked: () => providers.map((homeProvider) => ({ plugin: { homeProvider } })) },
}) as unknown as App;

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
  const form = String(await renderActions(app, 'p" onmouseover="attack()', [{
    id: 'a" onclick="attack()', name: "<b>Action</b>", fields: { value: "</option><script>attack()</script>" },
  }], [entity]));
  assertStringIncludes(form, 'data-provider="p&quot; onmouseover=&quot;attack()"');
  assertStringIncludes(form, "&lt;b&gt;Action&lt;/b&gt;");
  assertEquals(form.includes("<script>"), false);
  assertStringIncludes(form, "<option value=\"\">Select an action</option>");
});

Deno.test("home backend keeps healthy providers visible when another provider fails", async () => {
  const broken = { ...provider, name: "offline", entities: () => Promise.reject(new Error("<offline>")) };
  const node = { app: appOf(broken, provider) } as Node;
  const output = String(await list(node));
  assertStringIncludes(output, "&lt;offline&gt;");
  assertStringIncludes(output, "sensor.temp");
  assertStringIncludes(output, 'data-provider="other"');
  assertStringIncludes(output, 'data-provider="offline"');
  assertStringIncludes(String(await list({ app: appOf() } as Node)), "No home providers are linked.");
  assertEquals(cms.node.parts.list, list);
});

Deno.test("home backend commands use the real home API's validation and access checks", async () => {
  const dir = await Deno.makeTempDir(), app = new App({ dir, db: "sqlite::memory:" });
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  try {
    await app.init();
    const node = { app } as Node;
    const ctx = await testContext({ app: appOf(provider), set: { user: { id: 7 } } });
    await requestStorage.run(ctx, async () => {
      assertEquals(await api(node, {}), false);
      const result = await api(node, { provider: "other", action: "set", entities: [entity.id], data: { value: true } });
      assertEquals(result, {
        ok: true, message: "Action accepted\n" + JSON.stringify({ action: "set", input: { entities: [entity.id], data: { value: true } } }, null, 2),
        result: { action: "set", input: { entities: [entity.id], data: { value: true } } },
      });
      assertEquals((await api(node, { provider: "other", action: "set", data: [] }) as { ok: boolean }).ok, false);
      assertEquals((await api(node, { provider: "other", action: "set", entities: "bad" }) as { ok: boolean }).ok, false);
      assertEquals((await api(node, { action: "set" }) as { ok: boolean }).ok, false);
    });
    const guest = await testContext({ app: appOf(provider) });
    await requestStorage.run(guest, async () => {
      assertEquals(await api(node, { provider: "other", action: "set" }), { ok: false, message: "Access denied" });
    });
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
