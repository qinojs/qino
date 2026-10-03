// deno-lint-ignore-file no-explicit-any
import { Access, App, getCtx, s } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { listen, run } from "../mod.ts";

import type { Flow } from "../mod.ts";

/** A real app with user 7 and three routes as tools: test_who_get, test_echo_post, test_rename_post. */
async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  await app.init();
  const rename = ({ name }: any) => app.db.table("usr").update(7, { given_name: name });
  app.apiTree = {
    test: {
      who: { get: { access: Access.USER, execute: () => getCtx().userId } },
      echo: { post: { access: Access.USER, execute: (params: any) => params } },
      rename: { post: { access: Access.USER, input: s.object({ name: s.string() }), execute: rename } },
    },
  };
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await fn(app);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
  }
}

const on = { host: "db", event: "table:update-after" };
const flow = (steps: Flow["steps"], more: Partial<Flow> = {}): Flow =>
  ({ description: "test", on, owner: 7, steps, ...more });

Deno.test("sandbox.flow: steps pass their result on, tools run as the owner, the trace tells", () =>
  withApp(async (app) => {
    const trace = await run(app, flow([
      { description: "double", fn: (n: number) => n * 2 },
      { description: "ask", fn: async (n: number, { tools, owner }: any) => [n, await tools.test_who_get(), owner] },
    ], { tools: ["test_who_get"] }), 21, { user: 3 });
    assertEquals(trace.end, "done");
    assertEquals(trace.context, { user: 3 });
    assertEquals(trace.steps.map((s) => s.value), [42, [42, 7, 7]]);
    assertEquals(trace.steps[1].calls, [{ tool: "test_who_get", args: undefined, result: 7 }]);
  }));

Deno.test("sandbox.flow: a falsy result stops, an error ends the run", () =>
  withApp(async (app) => {
    const stopped = await run(app, flow([
      { description: "no", fn: () => false },
      { description: "never", fn: () => 1 },
    ]), 1);
    assertEquals([stopped.end, stopped.steps.length], ["stopped", 1]);
    const passed = await run(app, flow([
    { description: "odd?", fn: (n: number) => n % 2 === 1 },
    { description: "+1", fn: (n: number) => n + 1 },
  ]), 3);
  assertEquals([passed.end, passed.steps.map((s) => s.value)], ["done", [3, 4]]); // true passed 3 on
  const failed = await run(app, flow([{ description: "boom", fn: () => { throw new Error("boom"); } }]), 1);
    assertEquals([failed.end, failed.steps[0].error], ["error", "boom"]);
  }));

Deno.test("sandbox.flow: only allowed tools exist; a test run records what would change", () =>
  withApp(async (app) => {
    const trace = await run(app, flow([{
      description: "try",
      fn: async (_: unknown, { tools }: any) => [
        Object.keys(tools),
        await tools.test_echo_post({ a: 1 }),
        await tools.test_who_get(),
        // @ts-ignore: names of the wrapper around the step must not reach its code
        typeof tool + typeof input,
      ],
    }], { tools: ["test_echo_post", "test_who_get"] }), 1); // a flow tests unless told otherwise
    assertEquals(trace.steps[0].value, [["test_echo_post", "test_who_get"], undefined, 7, "undefinedundefined"]);
    assertEquals(trace.steps[0].calls, [
      { tool: "test_echo_post", args: { a: 1 }, skipped: true },
      { tool: "test_who_get", args: undefined, result: 7 },
    ]);
  }));

Deno.test("sandbox.flow: debounce lets only the latest run per key go on", () =>
  withApp(async (app) => {
    const f = flow([
      { description: "wait", debounce: { ms: 50, by: "id" } },
      { description: "go", fn: (e: any) => e.id },
    ]);
    const traces = await Promise.all([run(app, f, { id: 1 }), run(app, f, { id: 1 }), run(app, f, { id: 2 })]);
    assertEquals(traces.map((t) => t.end), ["superseded", "done", "done"]);
  }));

Deno.test("sandbox.flow: listens to its event, sees the event as data, ignores what its own run causes", () =>
  withApp(async (app) => {
    const traces: any[] = [];
    const stop = new AbortController();
    const done = new Promise((resolve) => {
      const report = (t: any) => (traces.push(t), t.end === "done" && resolve(t));
      listen(app, flow([
        { description: "family names only", fn: (e: any) => e.table === "usr" && "family_name" in e.data },
        {
          description: "rename",
          fn: async (e: any, { tools }: any) => (await tools.test_rename_post({ name: "Bob" }), e.table),
        },
      ], { tools: ["test_rename_post"], test: false }), { signal: stop.signal, report });
    });
    await app.db.table("usr").update(7, { family_name: "Smith" }); // its run renames user 7: an update again
    await done;
    await new Promise((r) => setTimeout(r, 200)); // time for a run its own writes would start
    stop.abort();
    // its run wrote usr twice (the rename, and usr.lang while its context was set up): no run for either
    assertEquals(traces.map((t) => [t.end, t.steps.at(-1).value]), [["done", "usr"]]);
    assertEquals(await app.db.one`SELECT given_name FROM usr WHERE id = 7`, "Bob");
  }));
