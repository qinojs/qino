import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const stored = (parameter: string) => ({
  id: 3, provider: 1, name: "<Brightness>", action: "notify.phone", targets: "[]",
  data: '{"message":"command_screen_brightness_level"}', parameter,
});

function nodeOf(parameter: string, settings: Record<string, unknown>, calls: unknown[]) {
  const app = {
    t: fakeT,
    db: { row: (strings: TemplateStringsArray) => Promise.resolve(strings.join("").includes("home_command")
      ? stored(parameter) : { id: 1, name: "Home", adapter: "fake", config: "{}", enabled: true }) },
    modules: { linked: () => [{ plugin: { homeProvider: {
      name: "fake", entities: () => Promise.resolve([]), actions: () => Promise.resolve([]),
      call: (_app: App, _id: number, action: string, input: unknown) => {
        calls.push({ action, input });
        return Promise.resolve();
      },
    } } }] },
  } as unknown as App;
  const values = { command: 3, label: "", ...settings };
  const proxy = new Proxy({}, { get: (_, key: string) => () => values[key as keyof typeof values] });
  return { app, settings: proxy } as unknown as Node;
}

Deno.test("home command block renders a button or a bounded value field and escapes names", async () => {
  const button = String(await cms.node.render(nodeOf("", {}, [])));
  assertStringIncludes(button, "<button type=button data-run>&lt;Brightness&gt;</button>");
  const slider = String(await cms.node.render(nodeOf("data.command", { min: 0, max: 255 }, [])));
  assertStringIncludes(slider, 'type=range min="0" max="255"');
  assertEquals(slider.includes("<Brightness>"), false);
});

Deno.test("home command block runs only its command and keeps values within its range", async () => {
  const calls: unknown[] = [], node = nodeOf("data.command", { min: 0, max: 255 }, calls);
  assertEquals(await cms.node.api(node, {}), null);
  assertEquals(await cms.node.api(node, { run: true, value: 153 }), { ok: true });
  assertEquals(calls, [{
    action: "notify.phone", input: { data: { message: "command_screen_brightness_level", data: { command: 153 } } },
  }]);
  for (const value of [256, -1, "153"]) {
    assertEquals((await cms.node.api(node, { run: true, value }) as { ok: boolean }).ok, false);
  }
  assertEquals(calls.length, 1);
});
