// deno-lint-ignore-file no-explicit-any
import { apiRequest, assertEquals, testContext } from "./deps.ts";
import { s } from "../lib/StandardSchema.ts";
import { Access, apiClient, invoke, toTools } from "../lib/api/mod.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

const ctx = await testContext();

const api = {
  item: {
    ":item": {
      paramSchema: s.number(),
      resolve: (id: number) => ({ id }),
      get: {
        description: "Read item",
        access: Access.PUBLIC,
        input: s.object({ detail: s.optional(s.string()) }),
        execute: ({ item, detail }: any) => ({ id: item.id, detail }),
      },
    },
  },
};

Deno.test("api split facade mirrors invoke, fetch, tools and client", async () => {
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/item/3", { detail: "yes" }), { id: 3, detail: "yes" });

    const res = await apiRequest(api, "/item/4?detail=yes");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { id: 4, detail: "yes" });

    const tool = toTools(api)[0];
    assertEquals(tool.name, "get_item");
    assertEquals(await tool.execute({ item: 5, detail: "yes" }, ctx), { id: 5, detail: "yes" });

    const client = apiClient(api);
    assertEquals(await client.item(6).get({ detail: "yes" }), { id: 6, detail: "yes" });
  });
});
