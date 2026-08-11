// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "../../core/tests/deps.ts";
import { toTools } from "../../core/mod.ts";
import { api, init, settingsSchema } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;
import { getCmsVers } from "../mod.ts";

Deno.test("cms.versions: module metadata is wired", () => {
  assertEquals(name, "cms.versions");
  assertEquals(dependencies, ["cms"]);
  assertEquals(settingsSchema.properties, {});
});

Deno.test("cms.versions: parked draft space stays inactive", async () => {
  const routes: ((event: any) => unknown)[] = [];
  const app = {
    db: { on() {} },
    on(name: string, listener: (event: any) => unknown) {
      if (name === "route") routes.push(listener);
    },
  };
  init(app as never, { signal: new AbortController().signal });
  const ctx = { state: {}, req: { query: { cms_versions_space: "1" } } };

  await routes.at(-1)!({ ctx });

  assertEquals(getCmsVers(ctx as never).space, 0);
});

Deno.test("cms.versions: historical views are dropped when setup fails", async () => {
  const routes: ((event: any) => unknown)[] = [];
  const queries: unknown[] = [];
  let columns = 0;
  const db = {
    on() {},
    query(...args: unknown[]) {
      queries.push(args);
    },
    columns() {
      if (++columns > 1) throw new Error("setup failed");
      return [{ Field: "id", Key: "PRI" }];
    },
  };
  const app = {
    db,
    on(name: string, listener: (event: any) => unknown) {
      if (name === "route") routes.push(listener);
    },
  };
  init(app as never, { signal: new AbortController().signal });
  const ctx = {
    app,
    state: {},
    req: { query: { cms_versions_log: "2", cms_versions_page: "1" } },
    res: { headers: new Headers() },
  };

  await assertRejects(async () => await routes.at(-1)!({ ctx }), Error, "setup failed");

  assertEquals(queries.length, 3); // create first view (2 queries), then drop it
});

Deno.test("cms.versions: api API exposes publish/page/log endpoints", () => {
  const tools = toTools(api);
  assertEquals(tools.map((tool) => tool.name), [
    "post_publishNode",
    "get_node",
    "get_log",
  ]);

  assertEquals(tools[0].parameters, {
    type: "object",
    properties: {
      pid: { type: "number" },
      options: { type: "object", additionalProperties: true },
    },
    required: ["pid"],
  });
});
