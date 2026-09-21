// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "./deps.ts";
import { s } from "../lib/StandardSchema.ts";
import { Access, ApiError, invoke } from "../lib/api/mod.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";
import { api } from "../api.ts";

Deno.test("core tool-calls: runs calls in order, stops at the first failure", async () => {
  const saved: number[] = [];
  const apiTree = {
    core: api,
    thing: {
      ":id": {
        paramSchema: s.number(),
        put: {
          access: Access.USER,
          input: s.object({ ok: s.boolean() }),
          execute: ({ id, ok }: any) => {
            if (!ok) throw new ApiError(409, "nope", { code: "conflict" });
            saved.push(id);
            return { id };
          },
        },
      },
    },
  };
  const ctx = await testContext({ userId: 1, app: { apiTree, db: { table: () => ({ row: () => ({ superuser: false }) }) } } });
  const run = (calls: unknown[]) => requestStorage.run(ctx, () => invoke(apiTree, "POST", "/core/tool-calls", { input: { calls } }));

  assertEquals(await run([
    { name: "put_thing", arguments: { id: 1, ok: true } },
    { name: "put_thing", arguments: { id: 2, ok: true } },
  ]), { results: [{ id: 1 }, { id: 2 }] });

  const err: any = await run([
    { name: "put_thing", arguments: { id: 3, ok: true } },
    { name: "put_thing", arguments: { id: 4, ok: false } },
    { name: "put_thing", arguments: { id: 5, ok: true } },
  ]).catch((e) => e);
  assertEquals([err.status, err.code, err.data], [409, "conflict", { index: 1, results: [{ id: 3 }] }]);
  assertEquals(saved, [1, 2, 3]);

  const self: any = await run([{ name: "post_core_toolCalls", arguments: { calls: [] } }]).catch((e) => e);
  assertEquals([self.status, self.data.index], [404, 0]);
});
