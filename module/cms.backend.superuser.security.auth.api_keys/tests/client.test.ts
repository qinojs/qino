import { runInNewContext } from "node:vm";
import { assertEquals } from "@qino/qino/tests";

Deno.test("API key backend: an empty node initializes and later handles its user filter", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const calls: unknown[] = [];
  const msg = { value: "" };
  const root = {
    addEventListener: (type: string, handler: (event: unknown) => Promise<void>) => handlers.set(type, handler),
    querySelector: () => null as unknown,
  };
  runInNewContext(source.replace(/^import .*;\n/gm, ""), { cms: {
    el: { nid: () => 42 },
    initNode: (_name: string, init: (el: typeof root) => void) => init(root),
    reloadPart: (...args: unknown[]) => calls.push(args),
  } });
  const unrelated = { target: { closest: () => null } };
  await handlers.get("change")!(unrelated);
  await handlers.get("submit")!(unrelated);
  assertEquals(calls.length, 0);

  const button = { disabled: true };
  const user = { value: "8", disabled: false, form: { querySelector: () => button } };
  root.querySelector = () => msg;
  for (const value of ["8", ""]) {
    user.value = value;
    await handlers.get("change")!({ target: { closest: () => user } });
    assertEquals(user.disabled, false);
    assertEquals(button.disabled, !value);
  }
  assertEquals(JSON.parse(JSON.stringify(calls)), [[42, "list", { usr_id: "8" }], [42, "list", { usr_id: "" }]]);
});

Deno.test("API key backend: creation uses the action route and keeps the returned key visible while refreshing", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const calls: unknown[] = [];
  const button = { disabled: false };
  const user = { value: "8", disabled: false };
  const name = { value: "Integration" };
  const msg = { value: "" };
  const code = { textContent: "" };
  const token = { hidden: true, querySelector: () => code };
  const form = { elements: { usr_id: user, name }, querySelector: () => button };
  const root = {
    addEventListener: (type: string, handler: (event: unknown) => Promise<void>) => handlers.set(type, handler),
    querySelector: (selector: string) => selector === "[data-token]" ? token : msg,
  };
  runInNewContext(source.replace(/^import .*;\n/gm, ""), {
    FormData: class { *[Symbol.iterator]() { yield ["usr_id", user.value]; yield ["name", name.value]; } },
    api: { cms: { node: (id: number) => ({ api: { post: (data: unknown) => {
      calls.push([id, data]);
      return { token: "qk_test" };
    } } }) } },
    cms: {
      el: { nid: () => 42 },
      initNode: (_name: string, init: (el: typeof root) => void) => init(root),
      reloadPart: () => {
        assertEquals(code.textContent, "qk_test");
        assertEquals(token.hidden, false);
        throw new Error("List unavailable");
      },
    },
  });
  await handlers.get("submit")!({ target: { closest: () => form }, preventDefault() {} });
  assertEquals(JSON.parse(JSON.stringify(calls)), [[42, { create: { usr_id: "8", name: "Integration" } }]]);
  assertEquals(code.textContent, "qk_test");
  assertEquals(token.hidden, false);
  assertEquals(msg.value, "List unavailable");
  assertEquals(user.disabled, false);
  assertEquals(button.disabled, false);
});
