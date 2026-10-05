import { assertEquals } from "@qino/qino/tests";

Deno.test("chart period controls convert local time to ISO and prevent overlapping reloads", async () => {
  const source = (await Deno.readTextFile(new URL("../pub/main.js", import.meta.url))).replace(/^import[^\n]*\n/, "");
  const listeners: Record<string, (event: unknown) => unknown> = {}, calls: unknown[][] = [];
  const start = "2026-01-01T00:00:00.000Z", end = "2026-01-02T00:00:00.000Z";
  const form = { dataset: { start, end }, elements: { start: { value: "" }, end: { value: "" } } };
  const root = { addEventListener: (name: string, listener: (event: unknown) => unknown) => { listeners[name] = listener; }, querySelector: () => form };
  let release: () => void;
  const cms = {
    initNode: (_name: string, init: (el: unknown) => void) => init(root), el: { nid: () => "42" },
    reloadPart: (...args: unknown[]) => { calls.push(args); return new Promise<void>((resolve) => { release = resolve; }); },
  };
  new Function("cms", source)(cms);
  assertEquals(new Date(form.elements.start.value).toISOString(), start);
  const click = (dataset: Record<string, string>) => listeners.click({ target: { closest: () => ({ dataset, form }) } });
  const first = click({ shift: "-1" });
  click({ shift: "1" });
  assertEquals(calls, [[42, "plot", { start: "2025-12-31T00:00:00.000Z", end: start }]]);
  release!();
  await first;
  let prevented = 0;
  form.elements.start.value = "2026-02-01T10:00";
  form.elements.end.value = "2026-02-01T12:00";
  listeners.submit({ target: { closest: () => form }, preventDefault: () => { prevented++; } });
  assertEquals(prevented, 1);
  assertEquals(calls[1][2], { start: new Date("2026-02-01T10:00").toISOString(), end: new Date("2026-02-01T12:00").toISOString() });
  release!();
});
