// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "@std/assert";

import { quickjs, Sandbox, worker } from "../mod.ts";

for (const [name, engine] of Object.entries({ quickjs, worker })) {
  Deno.test(`sandbox (${name}): runs a function or its source with input`, async () => {
    using box = new Sandbox({ engine });
    assertEquals(await box.run((n: number) => n * 2, 21), 42);
    assertEquals(await box.run("async (s) => s.toUpperCase()", "hi"), "HI");
    assertEquals(await box.run(() => undefined), undefined);
  });

  Deno.test(`sandbox (${name}): the code sees only its capabilities, calls come back here`, async () => {
    const seen: unknown[] = [];
    using box = new Sandbox({
      engine,
      capabilities: { tools: { add: (a: number, b: number) => a + b, log: async (x: unknown) => void seen.push(x) } },
    });
    assertEquals(await box.run(async (_: unknown, { tools }: any) => (await tools.log("hi"), tools.add(1, 2))), 3);
    assertEquals(seen, ["hi"]);
    assertEquals(await box.run((_: unknown, caps: any) => Object.keys(caps.tools)), ["add", "log"]);
  });

  Deno.test(`sandbox (${name}): a failing capability rejects in the code with name, message and code`, async () => {
    using box = new Sandbox({
      engine,
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

  Deno.test(`sandbox (${name}): errors of the code reject the run`, async () => {
    using box = new Sandbox({ engine });
    await assertRejects(() => box.run(() => { throw new TypeError("bad"); }), Error, "bad");
    await assertRejects(() => box.run("not a function ("), Error);
    assertEquals(await box.run(() => "still works"), "still works");
  });

  Deno.test(`sandbox (${name}): a timeout ends the engine, the next run starts a new one`, async () => {
    using box = new Sandbox({ engine, timeout: 200 });
    await assertRejects(() => box.run(() => { while (true); }), Error, "no result after 200 ms");
    await assertRejects(() => box.run(() => new Promise(() => {})), Error, "no result after 200 ms");
    assertEquals(await box.run(() => 1), 1);
  });

  Deno.test(`sandbox (${name}): undefined stays undefined, in arguments and results`, async () => {
    using box = new Sandbox({ engine, capabilities: { echo: (...args: unknown[]) => args } });
    assertEquals(await box.run(async (_: unknown, { echo }: any) => await echo(undefined, 1)), [undefined, 1]);
    assertEquals(await box.run((input: unknown) => input === undefined), true);
  });

  Deno.test(`sandbox (${name}): close fails running runs`, async () => {
    const box = new Sandbox({ engine, capabilities: { wait: () => new Promise(() => {}) } });
    const running = box.run(async (_: unknown, { wait }: any) => await wait());
    await new Promise((r) => setTimeout(r, 50)); // let it start
    box.close();
    await assertRejects(() => running, Error, "closed");
  });
}

Deno.test("sandbox (quickjs): nothing of the host is there — no files, network or env; timers are", async () => {
  using box = new Sandbox();
  const seen = await box.run(() => [typeof Deno, typeof fetch, typeof process, typeof require]);
  assertEquals(seen, ["undefined", "undefined", "undefined", "undefined"]);
  assertEquals(await box.run(() => new Promise((r) => setTimeout(r, 20, "waited"))), "waited");
  assertEquals(await box.run(() => new Promise((r) => (clearTimeout(setTimeout(r, 0, 1)), setTimeout(r, 30, 2)))), 2);
});

Deno.test("sandbox (worker): no files, no network, no environment", async () => {
  using box = new Sandbox({ engine: worker });
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

Deno.test("sandbox (quickjs): values cross as JSON; what JSON can't carry fails the call", async () => {
  using box = new Sandbox({ capabilities: { big: () => 1n, date: () => new Date(0) } });
  assertEquals(await box.run(async (_: unknown, { date }: any) => await date()), "1970-01-01T00:00:00.000Z");
  await assertRejects(() => box.run(async (_: unknown, { big }: any) => await big()), Error, "BigInt");
});

Deno.test("sandbox (quickjs): memory is capped", async () => {
  using box = new Sandbox();
  await assertRejects(() => box.run(() => { const a = []; while (true) a.push(new Array(1e5).fill(1)); }), Error);
  assertEquals(await box.run(() => "recovered"), "recovered");
});
