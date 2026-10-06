import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { control, live, renderActions, renderValues, views } from "../render.ts";
import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { save } from "@qino/qino/home";
import { fixture } from "./fixture.ts";

const entity = { id: "sensor.temp", name: "Temperature", state: 21.5, attributes: { unit: "°C" }, available: true };
const appOf = () => ({ t: fakeT }) as unknown as App;

Deno.test("home backend renders observations and action metadata safely without device-specific assumptions", async () => {
  const app = appOf();
  const bad = {
    ...entity, name: '<img src=x onerror="attack()">', state: false, available: false,
    attributes: { note: "</pre><script>attack()</script>" },
  };
  const provider = { id: 1, name: "<House>", adapter: "fake", config: {}, enabled: true };
  const output = String(await renderValues(app, [
    { provider, entity: bad, path: "", value: false }, { provider, entity: bad, path: "note", value: bad.attributes.note },
  ]));
  assertStringIncludes(output, ">sensor.temp/note</code>");
  // A list attribute holding the value proposes the state mapping; other text proposes itself.
  const button = { ...entity, id: "event.button", attributes: { event_types: ["press", "long_press"], event_type: "press" } };
  const proposed = String(await renderValues(app, [{ provider, entity: button, path: "event_type", value: "press" }]));
  assertStringIncludes(proposed, "&quot;options&quot;:[&quot;press&quot;,&quot;long_press&quot;]");
  assertStringIncludes(output, "&lt;img");
  assertStringIncludes(output, "&lt;/pre&gt;&lt;script&gt;");
  assertStringIncludes(output, "false");
  assertStringIncludes(output, "Unavailable");
  assertEquals(output.includes("<script>"), false);
  const form = String(await renderActions(app, 1, [{
    id: 'a" onclick="attack()', name: "<b>Action</b>", targets: [entity.id],
    input: { type: "object", properties: { value: { title: "</option><script>attack()</script>" } } },
  }], [entity]));
  assertStringIncludes(form, 'data-provider="1"');
  assertStringIncludes(form, "&lt;b&gt;Action&lt;/b&gt;");
  assertEquals(form.includes("<script>"), false);
  assertStringIncludes(form, 'list="home-action-1-list"');
  assertStringIncludes(form, "data-targets=\"[&quot;sensor.temp&quot;]\"");
});

Deno.test("home backend keeps healthy provider instances visible when another fails", async () => {
  const { app, close } = await fixture();
  try {
    await save(app, { name: "Offline", adapter: "fake", config: { url: "http://offline.test/" } });
    const output = String(await live({ app, url: () => Promise.resolve("/backend/home#cmspid9") } as unknown as Node));
    assertStringIncludes(output, "&lt;offline&gt;");
    assertStringIncludes(output, "sensor.temp");
    assertStringIncludes(output, "data-add-point");
    assertStringIncludes(output, "Offline: &lt;offline&gt;");
    assertStringIncludes(output, "data-new-point");
    // Search and provider filter; attributes only on request.
    const values = async (vars: Record<string, unknown>) => String(await live({ app, url: () => Promise.resolve("/backend/home#cmspid9") } as unknown as Node, { vars }));
    assertEquals((await values({ q: "nothing-like-this" })).includes("sensor.temp"), false);
    assertStringIncludes(await values({ q: "TEMP", provider: 1 }), "sensor.temp");
    assertEquals((await values({ provider: 2 })).includes("sensor.temp"), false);
    assertEquals(cms.node.parts, views);
  } finally { await close(); }
});

Deno.test("home backend stores, lists and runs commands", async () => {
  const { app, provider, close } = await fixture(), node = { app, url: () => Promise.resolve("/backend/home#cmspid9") } as unknown as Node;
  try {
    const command = { provider, name: "<Lamp>", action: "set", targets: [entity.id], data: { value: true } };
    assertEquals(await api(node, { command }), { ok: true, message: "Command saved." });
    const output = String(await control(node));
    assertStringIncludes(output, "&lt;Lamp&gt;");
    assertStringIncludes(output, 'data-run="1"');
    const result = await api(node, { run: 1 }) as { ok: boolean; result: unknown };
    assertEquals(result.result, { action: "set", input: { entities: [entity.id], data: { value: true } } });
    // A parameter turns the command into a setter: a typed field next to Run, the value goes to its path.
    assertEquals((await api(node, { command: { ...command, id: 1, parameter: "value" } }) as { ok: boolean }).ok, true);
    assertStringIncludes(String(await control(node)), 'data-run-command data-id="1"');
    const set = await api(node, { run: 1, value: false }) as { result: unknown };
    assertEquals(set.result, { action: "set", input: { entities: [entity.id], data: { value: false } } });
    assertEquals(await api(node, { removeCommand: 1 }), { ok: true, message: "Command deleted." });
    assertEquals((await api(node, { run: 1 }) as { ok: boolean }).ok, false);
  } finally { await close(); }
});

Deno.test("home backend commands validate their input; access is the backend page's", async () => {
  const { app, provider, close } = await fixture(), node = { app, url: () => Promise.resolve("/backend/home#cmspid9") } as unknown as Node;
  try {
    assertEquals(await api(node, {}), false);
    const result = await api(node, { provider, action: "set", entities: [entity.id], data: { value: true } }) as { ok: boolean; result: unknown };
    assertEquals(result.ok, true);
    assertEquals(result.result, { action: "set", input: { entities: [entity.id], data: { value: true } } });
    for (const input of [{ provider, action: "set", data: [] }, { provider, action: "set", entities: "bad" }, { action: "set" }])
      assertEquals((await api(node, input) as { ok: boolean }).ok, false);
  } finally { await close(); }
});
