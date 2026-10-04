import { assertEquals } from "@qino/qino/tests";

Deno.test("home backend submits once from the form, parses typed data and displays failures without executing", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const listeners: Record<string, (event: unknown) => Promise<void>> = {};
  const calls: unknown[] = [], messages: string[] = [];
  let refreshes = 0, prevented = 0;
  const button = { disabled: false };
  const form = {
    dataset: { provider: "other" },
    elements: { action: { value: "set" }, data: { value: '{"value":false}' }, entities: { selectedOptions: [{ value: "sensor.temp" }] } },
    querySelector: () => button,
  };
  let release: ((result: unknown) => void) | undefined;
  const root = {
    addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener; },
    querySelector: () => ({ set innerHTML(_value: string) { refreshes++; } }),
  };
  const cms = { el: { nid: () => "5" }, initNode: (_name: string, init: (el: unknown) => void) => init(root) };
  const api = { cms: { node: () => ({
    api: { post: (input: unknown) => { calls.push(input); return new Promise((resolve) => { release = resolve; }); } },
    html: { part: () => ({ get: () => Promise.resolve("") }) },
  }) } };
  const helper = await Deno.readTextFile(new URL("../../cms.backend/pub/js/node.mjs", import.meta.url));
  const nodePanel = new Function("api", "cms", "show", helper.replace(/^import[^\n]*\n/, "").replace("export function", "function")
    .replace(/const alert = async[^\n]*/, "const alert = show;") + "\nreturn nodePanel;")(api, cms, (message: string) => { messages.push(message); });
  new Function("cms", "nodePanel", source.replace(/^import[^\n]*\n/, ""))(cms, nodePanel);
  let target: unknown = form;
  const event = { target: { closest: () => target }, preventDefault: () => { prevented++; } };
  const first = listeners.submit(event);
  await listeners.submit(event);
  assertEquals(calls, [{ provider: "other", action: "set", entities: ["sensor.temp"], data: { value: false } }]);
  assertEquals(button.disabled, true);
  release!({ ok: true, message: 'Accepted\n{\n  "value": true\n}', result: { value: true } });
  await first;
  assertEquals(refreshes, 2);
  assertEquals(button.disabled, false);
  assertEquals(prevented, 2);
  assertEquals(messages[0], 'Accepted\n{\n  "value": true\n}');
  for (const data of ["[]", "null", "false", "broken JSON"]) {
    form.elements.data.value = data;
    await listeners.submit(event);
  }
  assertEquals(calls.length, 1);
  assertEquals(messages.length, 5);
  assertEquals(button.disabled, false);
  target = {
    dataset: { module: "custom.provider" },
    elements: [
      { name: "url", type: "url", value: "https://house.test/" },
      { name: "accessToken", type: "password", value: "" },
      { name: "enabled", type: "checkbox", checked: false },
      { name: "threshold", type: "number", valueAsNumber: 0 },
      { name: "ignored", type: "text", value: "hidden", disabled: true },
    ],
    querySelector: () => button,
  };
  const saved = listeners.submit(event);
  assertEquals(calls.at(-1), { config: { module: "custom.provider", values: {
    url: "https://house.test/", accessToken: "", enabled: false, threshold: 0,
  } } });
  release!({ ok: true, message: "Saved" });
  await saved;
  assertEquals(refreshes, 4);
  assertEquals(messages.at(-1), "Saved");
  const failed = listeners.submit(event);
  release!({ ok: false, message: "Invalid setting" });
  await failed;
  assertEquals(messages.at(-1), "Invalid setting");
  assertEquals(button.disabled, false);
  target = { ...button, dataset: { provider: "other", entity: "counter" }, checked: false };
  const recorded = listeners.change(event);
  assertEquals(calls.at(-1), { record: { provider: "other", entity: "counter", enabled: false } });
  release!({ ok: true, message: "Recording updated." });
  await recorded;
  assertEquals(messages.at(-1), "Recording updated.");
});
