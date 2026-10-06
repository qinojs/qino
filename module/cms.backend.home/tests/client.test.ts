import { assertEquals } from "@qino/qino/tests";

import { dataOf, read } from "../pub/action.js";

Deno.test("home backend submits once from the form, parses typed data and displays failures without executing", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const listeners: Record<string, (event: unknown) => Promise<void>> = {};
  const calls: unknown[] = [], messages: string[] = [];
  let refreshes = 0, prevented = 0;
  const button = { disabled: false };
  const form = {
    dataset: { provider: "1" },
    hasAttribute: (name: string) => name === "data-home-action",
    elements: { action: { value: "set" }, data: { value: '{"value":false}' }, entities: { selectedOptions: [{ value: "sensor.temp" }] } },
    querySelector: () => button, querySelectorAll: () => [], closest: () => null,
  };
  let release: ((result: unknown) => void) | undefined;
  const root = {
    addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener; },
    querySelector: () => ({ getAttribute: () => "live", set innerHTML(_value: string) { refreshes++; } }),
  };
  const cms = { el: { nid: () => "5" }, initNode: (_name: string, init: (el: unknown) => void) => init(root) };
  const api = { cms: { node: () => ({
    api: { post: (input: unknown) => { calls.push(input); return new Promise((resolve) => { release = resolve; }); } },
    html: { part: () => ({ get: () => Promise.resolve("") }) },
  }) } };
  const helper = await Deno.readTextFile(new URL("../../cms.backend/pub/js/node.mjs", import.meta.url));
  const nodePanel = new Function("api", "cms", "show", helper.replace(/^import[^\n]*\n/, "").replace("export function", "function")
    .replace(/const alert = async[^\n]*/, "const alert = show;") + "\nreturn nodePanel;")(api, cms, (message: string) => { messages.push(message); });
  new Function("cms", "nodePanel", "dataOf", "read", source.replace(/^import[^\n]*\n/gm, ""))(cms, nodePanel, dataOf, read);
  let target: unknown = form;
  const event = { target: { closest: () => target }, preventDefault: () => { prevented++; } };
  const first = listeners.submit(event);
  await listeners.submit(event);
  assertEquals(calls, [{ provider: 1, action: "set", entities: ["sensor.temp"], data: { value: false } }]);
  assertEquals(button.disabled, true);
  release!({ ok: true, message: 'Accepted\n{\n  "value": true\n}', result: { value: true } });
  await first;
  assertEquals(refreshes, 0);
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
    ], { name: { value: "House" }, enabled: { checked: false } }),
    querySelector: () => button, closest: () => null,
  };
  const saved = listeners.submit(event);
  assertEquals(calls.at(-1), { config: { id: 1, name: "House", adapter: "fake", enabled: false, config: { accessToken: "", threshold: 0 } } });
  release!({ ok: true, message: "Saved" });
  await saved;
  assertEquals(refreshes, 1);
  assertEquals(messages.at(-1), "Saved");
  const failed = listeners.submit(event);
  release!({ ok: false, message: "Invalid setting" });
  await failed;
  assertEquals(messages.at(-1), "Invalid setting");
  assertEquals(button.disabled, false);
  target = { ...button, dataset: { id: "1" }, checked: false };
  const recorded = listeners.change(event);
  assertEquals(calls.at(-1), { datapoint: { id: 1, record: false } });
  release!({ ok: true, message: "Recording updated." });
  await recorded;
  assertEquals(messages.at(-1), "Recording updated.");
  target = {
    dataset: { id: "7" }, hasAttribute: (name: string) => name === "data-measurement",
    elements: { value: { valueAsNumber: 0 }, time: { value: "2026-01-01T12:00:00.123" } },
    querySelector: () => button, closest: () => null,
  };
  const entered = listeners.submit(event);
  assertEquals(calls.at(-1), { measurement: { id: 7, value: 0, time: new Date("2026-01-01T12:00:00.123").getTime() } });
  release!({ ok: true, message: "Measurement saved." });
  await entered;
  const count = calls.length;
  target = {
    dataset: { id: "7" }, hasAttribute: (name: string) => name === "data-measurement",
    elements: { value: { valueAsNumber: NaN }, time: { value: "" } },
    querySelector: () => button, closest: () => null,
  };
  await listeners.submit(event);
  assertEquals(calls.length, count);
  assertEquals(messages.at(-1), "Enter a valid value and time");
  target = {
    dataset: { provider: "0", entity: "" }, hasAttribute: (name: string) => name === "data-datapoint",
    elements: { provider: { value: "2" }, entity: { value: "" }, name: { value: "Temperature" }, unit: { value: "°C" }, type: { value: "number" }, interval: { valueAsNumber: 0 }, record: { checked: true } },
    querySelectorAll: () => [], querySelector: () => button, closest: () => null,
  };
  const created = listeners.submit(event);
  const input = calls.at(-1) as { datapoint: { entity: string; provider: number; record: boolean } };
  assertEquals(input.datapoint.provider, 2);
  assertEquals(input.datapoint.record, true);
  assertEquals(/^[a-f0-9-]{36}$/.test(input.datapoint.entity), true);
  release!({ ok: true, message: "Datapoint saved." });
  await created;
  target = { ...(target as object), dataset: { id: "3", provider: "2", entity: "sensor.temp" } };
  const edited = listeners.submit(event);
  assertEquals(calls.at(-1), { datapoint: { id: 3, name: "Temperature", interval: 0, record: true } });
  release!({ ok: true, message: "Datapoint saved." });
  await edited;

});

Deno.test("home backend reads action fields typed and leaves empty ones out", () => {
  const field = (name: string, type: string, value: string) => ({ name: "data." + name, value, dataset: { type } });
  const form = (fields: unknown[], free?: unknown) => ({ elements: { data: free }, querySelectorAll: () => fields });
  assertEquals(dataOf(form([
    field("level", "number", "5"), field("on", "boolean", "false"), field("text", "string", "hi"),
    field("extra", "json", '{"command":"turn_on"}'), field("unset", "number", ""), field("off", "boolean", ""),
  ], { disabled: true, value: "ignored" })), { level: 5, on: false, text: "hi", extra: { command: "turn_on" } });
  assertEquals(dataOf(form([], { value: '{"a":1}' })), { a: 1 });
  let message = "";
  try { dataOf(form([field("extra", "json", "{broken")])); } catch (error) { message = (error as Error).message; }
  assertEquals(message, "extra: invalid JSON");
});

Deno.test("home backend reads free command values as JSON where they parse", () => {
  const field = (value: string) => ({ name: "value", value, dataset: { type: "auto" } });
  assertEquals(["153", "true", '{"a":1}', "on", ""].map((value) => read(field(value))), [153, true, { a: 1 }, "on", ""]);
});
