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
const flow = (code: string, more: Partial<Flow> = {}): Flow => ({ description: "test", on, owner: 7, code, ...more });

Deno.test("sandbox.flow: the code gets the event, tools run as the owner, the trace tells", () =>
  withApp(async (app) => {
    const trace = await run(app, flow(`
      const n = event * 2;
      return [n, await tools.test_who_get(), owner, context.user];
    `, { tools: ["test_who_get"] }), 21, { user: 3 });
    assertEquals([trace.end, trace.context, trace.result], ["done", { user: 3 }, [42, 7, 7, 3]]);
    assertEquals(trace.calls, [{ tool: "test_who_get", args: undefined, result: 7 }]);
  }));

Deno.test("sandbox.flow: an error ends the run", () =>
  withApp(async (app) => {
    const failed = await run(app, flow(`throw new Error("boom")`), 1);
    assertEquals([failed.end, failed.error], ["error", "boom"]);
  }));

Deno.test("sandbox.flow: only allowed tools exist; a test run records what would change", () =>
  withApp(async (app) => {
    const trace = await run(app, flow(`return [
      Object.keys(tools),
      await tools.test_echo_post({ a: 1 }),
      await tools.test_who_get(),
      typeof tool + typeof input, // names of the wrapper around the code must not reach it
    ]`, { tools: ["test_echo_post", "test_who_get"] }), 1); // a flow tests unless told otherwise
    assertEquals(trace.result, [["test_echo_post", "test_who_get"], undefined, 7, "undefinedundefined"]);
    assertEquals(trace.calls, [
      { tool: "test_echo_post", args: { a: 1 }, skipped: true },
      { tool: "test_who_get", args: undefined, result: 7 },
    ]);
  }));

Deno.test("sandbox.flow: listens to its event, sees the event as data, ignores what its own run causes", () =>
  withApp(async (app) => {
    const traces: any[] = [];
    const stop = new AbortController();
    const done = new Promise((resolve) => {
      const report = (t: any) => (traces.push(t), t.result && resolve(t));
      listen(app, flow(`
        if (event.table !== "usr" || !("family_name" in event.data)) return;
        await tools.test_rename_post({ name: "Bob" });
        return event.table;
      `, { tools: ["test_rename_post"], test: false }), { signal: stop.signal, report });
    });
    await app.db.table("usr").update(7, { family_name: "Smith" }); // its run renames user 7: an update again
    await done;
    await new Promise((r) => setTimeout(r, 200)); // time for a run its own writes would start
    stop.abort();
    // its run wrote usr twice (the rename, and usr.lang while its context was set up): no run for either
    assertEquals(traces.map((t) => [t.end, t.result]), [["done", "usr"]]);
    assertEquals(await app.db.one`SELECT given_name FROM usr WHERE id = 7`, "Bob");
  }));

