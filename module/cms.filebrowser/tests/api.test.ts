// deno-lint-ignore-file no-explicit-any
import { assertEquals, fakeRender } from "../../core/tests/deps.ts";
import { fakeCms } from "../../cms/tests/deps.ts";
import { toTools } from "../../core/mod.ts";
import { api, init, name, needs } from "../plugin.ts";

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

Deno.test("cms.filebrowser: init registers cms:page-ready asset hook", async () => {
  const handlers: Record<string, Function[]> = {};
  const app = {
    on(name: string, fn: Function) {
      (handlers[name] ??= []).push(fn);
    },
    db: { row: () => null, on() {} },
  };
  init(app as any, { signal: new AbortController().signal });
  assertEquals(handlers["cms:page-ready"].length, 1);

  const added: string[] = [];
  await handlers["cms:page-ready"][0]({
    ctx: {
      req: { query: {}, modulePath: "/m/" },
      state: { cms: { editmode: true } },
      res: { html: { scripts: { add: (url: string) => added.push(url) } } },
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
  const app = {
    db: {
      query: (...a: any[]) => {
        const [, params] = fakeRender(a[0], a.slice(1));
        assertEquals(params.slice(0, 3), ["cat", "%cat%", "cat%"]);
        return [
          { pid: 10, id: 1, mime: "image/jpeg", name: "a.jpg", md5: "same", access: 1 },
          { pid: 11, id: 2, mime: "image/jpeg", name: "a-copy.jpg", md5: "same", access: 1 },
          { pid: 12, id: 3, mime: "image/jpeg", name: "private.jpg", md5: "private", access: 1 },
        ];
      },
    },
    dbFiles: {
      file: (id: number) => dbFiles[id],
    },
  };
  fakeCms(app, {
    node: (id: number) => ({
      id,
      title: () => ({ string: () => `Page ${id}` }),
    }),
  } as never);
  const ctx = { app };

  const res = await api.search.get!.execute({ s: "cat" }, ctx as any);
  assertEquals(res, [{
    id: 1,
    mime: "image/jpeg",
    url: "/file/a.jpg",
    name: "a.jpg",
    pages: { "10": "Page 10", "11": "Page 11" },
  }]);
});
