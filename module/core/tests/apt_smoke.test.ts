import { assertEquals, assertRejects, testContext } from "./deps.ts";
import { s } from "../lib/StandardSchema.ts";
import { Access, AccessError, NotFoundError, aptClient, invoke, toTools } from "../lib/apt/mod.ts";
import { requestStorage } from "../lib/ctx/RequestContext.ts";

const fakeCtx = await testContext();
fakeCtx.lang = "de";

const mockPages = new Map<string, { id: string; title: string; access: () => number }>([
  ["1", { id: "1", title: "Home", access: () => 3 }],
  ["2", { id: "2", title: "Secret", access: () => 0 }],
]);

const api = {
  page: {
    ":page": {
      resolve: (id: string) => {
        const p = mockPages.get(id);
        if (!p) throw new NotFoundError(`page ${id}`);
        if (p.access() < 1) throw new AccessError(`no view on ${id}`);
        return p;
      },
      get: {
        description: "Read page",
        access: Access.PUBLIC,
        execute: ({ page }: { page: { id: string; title: string } }) => ({ id: page.id, title: page.title }),
      },
      copy: {
        post: {
          description: "Copy a page",
          access: Access.PUBLIC,
          input: s.object({ deep: s.boolean().default(false) }),
          output: s.object({ id: s.string() }),
          execute: async ({ page, deep }: { page: { id: string; access: () => number }; deep: boolean }) => {
            if (page.access() < 2) throw new AccessError("copy needs write");
            return { id: page.id + "-copy" + (deep ? "-deep" : "") };
          },
        },
      },
    },
  },
};

function withCtx<T>(fn: () => T): T {
  return requestStorage.run(fakeCtx, fn);
}

Deno.test("apt smoke: invoke resolves, validates defaults and surfaces typed errors", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "GET", "/page/1"), { id: "1", title: "Home" });
    assertEquals(await invoke(api, "POST", "/page/1/copy", {}), { id: "1-copy" });
    assertEquals(await invoke(api, "POST", "/page/1/copy", { deep: true }), { id: "1-copy-deep" });
    await assertRejects(() => invoke(api, "GET", "/page/2"), AccessError);
    await assertRejects(() => invoke(api, "GET", "/page/9"), NotFoundError);
    await assertRejects(() => invoke(api, "GET", "/page"), NotFoundError);
  });
});

Deno.test("apt smoke: toTools exposes executable tool contracts", () => {
  const tools = toTools(api);
  assertEquals(tools.map((tool) => tool.name), ["get_page", "post_page_copy"]);
  assertEquals(tools[1].parameters, {
    type: "object",
    properties: {
      page: { type: "string" },
      deep: { type: "boolean" },
    },
    required: ["page"],
  });
});

Deno.test("apt smoke: aptClient mirrors route tree", async () => {
  await withCtx(async () => {
    const rpc = aptClient(api);
    assertEquals(await rpc.page("1").get(), { id: "1", title: "Home" });
    assertEquals(await rpc.page("1").copy.post({ deep: true }), { id: "1-copy-deep" });
  });
});
