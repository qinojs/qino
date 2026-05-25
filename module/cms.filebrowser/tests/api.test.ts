// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { toTools } from "../../core/lib/apt/mod.ts";
import { api, init, name, needs } from "../mod.ts";

Deno.test("cms.filebrowser: metadata and apt shape are wired", () => {
  assertEquals(name, "cms.filebrowser");
  assertEquals(needs, ["cms"]);
  const tools = toTools(api);
  assertEquals(tools.map((tool) => tool.name), ["get_search"]);
  assertEquals(tools[0].parameters, {
    type: "object",
    properties: { s: { type: "string" } },
    required: [],
  });
});

Deno.test("cms.filebrowser: init registers apt tree and cms-ready asset hook", async () => {
  const handlers: Record<string, Function[]> = {};
  const app = {
    aptTree: {},
    on(name: string, fn: Function) {
      (handlers[name] ??= []).push(fn);
    },
    db: { row: () => null },
  };
  init(app as any);
  assertEquals((app.aptTree as any)["cms.filebrowser"], api);
  assertEquals(handlers["cms-ready"].length, 1);

  const added: string[] = [];
  await handlers["cms-ready"][0]({
    ctx: {
      get: {},
      state: { editmode: true },
      sysURL: "/m/",
      html: { scripts: { add: (url: string) => added.push(url) } },
    },
  });
  assertEquals(added, ["/m/cms.filebrowser/pub/init.mjs"]);
});

Deno.test("cms.filebrowser: search groups existing accessible files by md5", async () => {
  const dbFiles: Record<number, any> = {
    1: {
      name: "a.jpg",
      exists: () => true,
      access: () => true,
      url: () => "/file/a.jpg",
    },
    2: {
      name: "a-copy.jpg",
      exists: () => true,
      access: () => true,
      url: () => "/file/a-copy.jpg",
    },
    3: {
      name: "private.jpg",
      exists: () => true,
      access: () => false,
      url: () => "/file/private.jpg",
    },
  };
  const ctx = {
    app: {
      db: {
        all: (_sql: string, params: unknown[]) => {
          assertEquals(params.slice(0, 3), ["cat", "%cat%", "cat%"]);
          return [
            { pid: 10, id: 1, mime: "image/jpeg", name: "a.jpg", md5: "same", access: 1 },
            { pid: 11, id: 2, mime: "image/jpeg", name: "a-copy.jpg", md5: "same", access: 1 },
            { pid: 12, id: 3, mime: "image/jpeg", name: "private.jpg", md5: "private", access: 1 },
          ];
        },
      },
      cms: {
        node: (id: number) => ({
          id,
          title: () => ({ string: () => `Page ${id}` }),
        }),
      },
      dbFiles: {
        file: (id: number) => dbFiles[id],
      },
    },
  };

  const res = await api.search.get!.execute({ s: "cat" }, ctx as any);
  assertEquals(res, [{
    id: 1,
    mime: "image/jpeg",
    url: "/file/a.jpg",
    name: "a.jpg",
    pages: { "10": "Page 10", "11": "Page 11" },
  }]);
});
