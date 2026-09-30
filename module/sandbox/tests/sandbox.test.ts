// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "@std/assert";

import { Sandbox } from "../mod.ts";

Deno.test("sandbox: runs a function or its source with input", async () => {
  using box = new Sandbox();
  assertEquals(await box.run((n: number) => n * 2, 21), 42);
  assertEquals(await box.run("async (s) => s.toUpperCase()", "hi"), "HI");
});

Deno.test("sandbox: the code sees only its capabilities, calls come back here", async () => {
  const seen: unknown[] = [];
  using box = new Sandbox({
    capabilities: { tools: { add: (a: number, b: number) => a + b, log: async (x: unknown) => void seen.push(x) } },
  });
  assertEquals(await box.run(async (_: unknown, { tools }: any) => (await tools.log("hi"), tools.add(1, 2))), 3);
  assertEquals(seen, ["hi"]);
  assertEquals(await box.run((_: unknown, caps: any) => Object.keys(caps.tools)), ["add", "log"]);
});

Deno.test("sandbox: a failing capability rejects in the code with name, message and code", async () => {
  using box = new Sandbox({
    capabilities: { fail: () => { throw Object.assign(new Error("nope"), { name: "ApiError", code: "denied" }); } },
  });
  const caught = await box.run(async (_: unknown, { fail }: any) => {
    try {
      await fail();
    } catch (e: any) {
      return [e.name, e.message, e.code];
    }
  });
  assertEquals(caught, ["ApiError", "nope", "denied"]);
});

Deno.test("sandbox: no files, no network, no environment", async () => {
  using box = new Sandbox();
  const tried = await box.run(async () => {
    const out: Record<string, string> = {};
    for (const [name, f] of Object.entries({
      read: () => Deno.readTextFile("/etc/hostname"),
      net: () => fetch("https://example.com"),
      env: () => Deno.env.get("HOME"),
    })) {
      try { await f(); out[name] = "allowed"; } catch (e: any) { out[name] = e.name; }
    }
    return out;
  });
  assertEquals(tried, { read: "NotCapable", net: "NotCapable", env: "NotCapable" });
});

Deno.test("sandbox: errors of the code reject the run", async () => {
  using box = new Sandbox();
  await assertRejects(() => box.run(() => { throw new TypeError("bad"); }), Error, "bad");
  await assertRejects(() => box.run("not a function ("), Error);
  assertEquals(await box.run(() => "still works"), "still works");
});

Deno.test("sandbox: a timeout ends the worker, the next run starts a new one", async () => {
  using box = new Sandbox({ timeout: 200 });
  await assertRejects(() => box.run(() => { while (true); }), Error, "no result after 200 ms");
  assertEquals(await box.run(() => 1), 1);
});

Deno.test("sandbox: close fails running runs", async () => {
  const box = new Sandbox();
  const running = box.run(() => new Promise(() => {}));
  box.close();
  await assertRejects(() => running, Error, "closed");
});
