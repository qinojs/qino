import { assertEquals } from "@qino/qino/tests";

Deno.test("chart period submission uses the CMS part contract and prevents overlapping reloads", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  let submit: (event: unknown) => Promise<void>;
  const button = { disabled: false }, calls: unknown[] = [];
  const root = { addEventListener: (_name: string, listener: typeof submit) => { submit = listener; } };
  const form = { elements: { start: { value: "2026-01-01T00:00:00Z" }, end: { value: "2026-01-02T00:00:00Z" } }, querySelector: () => button };
  let release: () => void;
  const cms = {
    initNode: (_name: string, init: (el: unknown) => void) => init(root), el: { nid: () => "42" },
    reloadPart: (...args: unknown[]) => { calls.push(args); return new Promise<void>((resolve) => { release = resolve; }); },
  };
  new Function("cms", source)(cms);
  let prevented = 0;
  const event = { target: { closest: () => form }, preventDefault: () => { prevented++; } };
  const first = submit!(event);
  await submit!(event);
  assertEquals(calls, [[42, "plot", { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" }]]);
  assertEquals(prevented, 2);
  assertEquals(button.disabled, true);
  release!();
  await first;
  assertEquals(button.disabled, false);
});
