import { runInNewContext } from "node:vm";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.search: live requests keep their entry in input order, including clearing during a request", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const handlers = new Map<string, (event: unknown) => void>();
  const timers = new Map<number, () => void>();
  const calls: { vars: Record<string, unknown>; resolve: (out: string) => void }[] = [];
  let timer = 0;
  const output = { innerHTML: "" };
  const box = {
    getAttribute: () => "42",
    querySelector: (selector: string) => selector === "[cms-part=hits]" ? output : null,
  };
  const input = { value: "", closest: () => box };
  const document = {
    addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn),
    createElement: () => {
      const template = { innerHTML: "", content: { querySelector: () => ({ dataset: { searchEntry: template.innerHTML } }) } };
      return template;
    },
  };
  runInNewContext(source.replace(/^import .*;\n/gm, ""), {
    document, URL, console, location: { href: "http://qino.test/" }, history: { replaceState() {} },
    setTimeout: (fn: () => void) => (timers.set(++timer, fn), timer),
    clearTimeout: (id: number) => timers.delete(id),
    api: { cms: { node: () => ({ html: { part: () => ({
      post: ({ vars }: { vars: Record<string, unknown> }) => new Promise<string>((resolve) => calls.push({ vars, resolve })),
    }) } }) } },
  });
  const type = (value: string) => {
    input.value = value;
    handlers.get("input")!({ target: { closest: () => input } });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const send = async () => {
    for (const fn of timers.values()) fn();
    timers.clear();
    await settle();
  };

  type("lem");
  await send();
  type("lemon");
  await send();
  assertEquals(calls.length, 1, "The next request waits for the previous entry's token.");
  calls[0].resolve('{"entry":1}');
  await settle();
  assertEquals(calls[1].vars.entry, 1);
  assertEquals(calls[1].vars.search, "lemon");
  assertEquals(output.innerHTML, "", "An outdated response does not replace the visible results.");
  calls[1].resolve('{"entry":1}');
  await settle();
  assertEquals(output.innerHTML, '{"entry":1}');

  type("lemon tart");
  await send();
  type("");
  type("apple");
  await send();
  calls[2].resolve('{"entry":1}');
  await settle();
  assertEquals(calls[3].vars.search, "apple");
  assertEquals(calls[3].vars.entry, undefined, "Clearing ends the search even while an older request is pending.");
  calls[3].resolve('{"entry":2}');
  await settle();
  type("apple pie");
  await send();
  assertEquals(calls[4].vars.entry, 2);
  calls[4].resolve('{"entry":2}');
  await settle();
});
