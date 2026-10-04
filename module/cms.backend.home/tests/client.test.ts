import { assertEquals } from "@qino/qino/tests";

Deno.test("home backend submits once from the form, parses typed data and displays failures without executing", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const listeners: Record<string, (event: unknown) => Promise<void>> = {};
  const calls: unknown[] = [], messages: string[] = [];
  let refreshes = 0, prevented = 0;
  const button = { disabled: false };
  const form = {
    dataset: { provider: "1" },
    hasAttribute: () => false,
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
  assertEquals(calls, [{ provider: 1, action: "set", entities: ["sensor.temp"], data: { value: false } }]);
  assertEquals(button.disabled, true);
  release!({ ok: true, message: 'Accepted\n{\n  "value": true\n}', result: { value: true } });
  await first;
  assertEquals(refreshes, 3);
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
    dataset: { adapter: "fake", provider: "1" },
    hasAttribute: (name: string) => name === "data-provider-config",
    elements: Object.assign([
      { name: "config.accessToken", type: "password", value: "" },
      { name: "config.threshold", type: "number", valueAsNumber: 0 },
      { name: "config.ignored", type: "text", value: "hidden", disabled: true },
    ], { name: { value: "House" }, url: { value: "https://house.test/" }, enabled: { checked: false } }),
    querySelector: () => button,
  };
  const saved = listeners.submit(event);
  assertEquals(calls.at(-1), { config: { id: 1, name: "House", adapter: "fake", url: "https://house.test/", enabled: false, config: { accessToken: "", threshold: 0 } } });
  release!({ ok: true, message: "Saved" });
  await saved;
  assertEquals(refreshes, 6);
  assertEquals(messages.at(-1), "Saved");
  const failed = listeners.submit(event);
  release!({ ok: false, message: "Invalid setting" });
  await failed;
  assertEquals(messages.at(-1), "Invalid setting");
  assertEquals(button.disabled, false);
  target = { ...button, dataset: { point: JSON.stringify({ id: 1, provider: 1, entity: "counter" }) }, checked: false };
  const recorded = listeners.change(event);
  assertEquals(calls.at(-1), { datapoint: { id: 1, provider: 1, entity: "counter", record: false } });
  release!({ ok: true, message: "Recording updated." });
  await recorded;
  assertEquals(messages.at(-1), "Recording updated.");
  target = {
    dataset: { id: "7" }, hasAttribute: (name: string) => name === "data-measurement",
    elements: { value: { valueAsNumber: 0 }, time: { value: "2026-01-01T12:00:00.123" } },
    querySelector: () => button,
  };
  const entered = listeners.submit(event);
  assertEquals(calls.at(-1), { measurement: { id: 7, value: 0, time: new Date("2026-01-01T12:00:00.123").getTime() } });
  release!({ ok: true, message: "Measurement saved." });
  await entered;
  const count = calls.length;
  target = {
    dataset: { id: "7" }, hasAttribute: (name: string) => name === "data-measurement",
    elements: { value: { valueAsNumber: NaN }, time: { value: "" } },
    querySelector: () => button,
  };
  await listeners.submit(event);
  assertEquals(calls.length, count);
  assertEquals(messages.at(-1), "Enter a valid value and time");
  target = {
    dataset: { provider: "0", entity: "" }, hasAttribute: (name: string) => name === "data-datapoint",
    elements: { provider: { value: "2" }, entity: { value: "" }, name: { value: "Temperature" }, unit: { value: "°C" }, type: { value: "number" }, interval: { valueAsNumber: 0 }, record: { checked: true } },
    querySelectorAll: () => [], querySelector: () => button,
  };
  const created = listeners.submit(event);
  const input = calls.at(-1) as { datapoint: { entity: string; provider: number; record: boolean } };
  assertEquals(input.datapoint.provider, 2);
  assertEquals(input.datapoint.record, true);
  assertEquals(/^[a-f0-9-]{36}$/.test(input.datapoint.entity), true);
  release!({ ok: true, message: "Datapoint saved." });
  await created;

});
