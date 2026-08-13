// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";
import { init } from "../plugin.ts";

Deno.test("cms.templateParser: a remote module resolves template.html beside plugin.ts", async () => {
  const real = globalThis.fetch;
  const base = `https://qino.test/${crypto.randomUUID()}/`;
  let listener: (e: any) => Promise<void> = async () => {};
  globalThis.fetch = (input: string | URL | Request) => {
    assertEquals(String(input), base + "template.html");
    return Promise.resolve(new Response("<div>remote</div>"));
  };
  try {
    init({ on: (_name: string, fn: typeof listener) => listener = fn } as never, { signal: new AbortController().signal });
    const event: any = { node: { module: { source: base + "plugin.ts" } }, render: null };
    await listener(event);
    assertEquals(await event.render(event.node), "<div>remote</div>");
  } finally {
    globalThis.fetch = real;
  }
});
