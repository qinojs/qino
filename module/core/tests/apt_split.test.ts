// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { s } from "../lib/StandardSchema.ts";
import { Access, aptClient, invoke, toHono, toTools } from "../lib/apt/mod.ts";
import { RequestContext, requestStorage } from "../lib/RequestContext.ts";
import { AnswerError } from "../lib/util.ts";

const ctx = new RequestContext();
ctx.session = { liveUser: () => 0 } as any;

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

Deno.test("apt split facade mirrors invoke, Hono, tools and client", async () => {
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/item/3", { detail: "yes" }), { id: 3, detail: "yes" });

    const app = toHono(api);
    app.onError((e) => e instanceof AnswerError ? new Response(JSON.stringify(e.data), { status: e.status }) : new Response(null, { status: 500 }));
    const res = await app.request("/item/4?detail=yes");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { id: 4, detail: "yes" });

    const tool = toTools(api)[0];
    assertEquals(tool.name, "get_item");
    assertEquals(await tool.execute({ item: 5, detail: "yes" }, ctx), { id: 5, detail: "yes" });

    const client = aptClient(api);
    assertEquals(await client.item(6).get({ detail: "yes" }), { id: 6, detail: "yes" });
  });
});
