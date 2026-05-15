// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects, assertThrows } from "../../../deps.ts";
import { s } from "../lib/StandardSchema.ts";
import {
  Access,
  AccessError,
  NotFoundError,
  ValidationError,
  aptClient,
  invoke,
  isStaticAccess,
  toTools,
} from "../lib/apt.ts";
import { RequestContext, requestStorage } from "../lib/RequestContext.ts";

const ctx = new RequestContext();
ctx.lang = "de";
ctx.session = { liveUser: () => 0 } as any;

const things = new Map<number, { id: number; title: string; writable: boolean }>([
  [1, { id: 1, title: "One", writable: true }],
  [2, { id: 2, title: "Two", writable: false }],
]);

const api = {
  thing: {
    ":thing": {
      paramSchema: s.number(),
      resolve: (id: number) => {
        const thing = things.get(id);
        if (!thing) throw new NotFoundError(`thing ${id}`);
        return thing;
      },
      get: {
        description: "Read thing",
        access: Access.PUBLIC,
        output: s.object({ id: s.number(), title: s.string() }),
        execute: ({ thing }: any) => ({ id: thing.id, title: thing.title }),
      },
      update: {
        post: {
          description: "Update thing",
          access: ({ thing }: any) => thing.writable,
          input: s.object({
            title: s.string(),
            count: s.number(),
            enabled: s.boolean().default(false),
          }),
          query: s.object({ preview: s.boolean().default(false) }),
          execute: ({ thing, title, count, enabled, preview }: any) => ({
            id: thing.id,
            title,
            count,
            enabled,
            preview,
          }),
        },
      },
    },
  },
  closed: {
    get: {
      description: "No access",
      access: () => false,
      execute: () => ({ ok: true }),
    },
  },
};

function withCtx<T>(fn: () => T): T {
  return requestStorage.run(ctx, fn);
}

Deno.test("apt: static access metadata is marked", () => {
  assertEquals(isStaticAccess(Access.PUBLIC), true);
  assertEquals(isStaticAccess(Access.USER), true);
  assertEquals(isStaticAccess(() => true), false);
});

Deno.test("apt: invoke resolves path params and validates output", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "GET", "/thing/1"), { id: 1, title: "One" });
  });
});

Deno.test("apt: invoke coerces input and query fields", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "POST", "/thing/1/update", {
      title: "New",
      count: "7",
      enabled: "1",
      preview: "true",
    }), {
      id: 1,
      title: "New",
      count: 7,
      enabled: true,
      preview: true,
    });
  });
});

Deno.test("apt: access and validation errors are typed", async () => {
  await withCtx(async () => {
    await assertRejects(() => invoke(api, "GET", "/thing/9"), NotFoundError);
    await assertRejects(() => invoke(api, "GET", "/closed"), AccessError);
    await assertRejects(() => invoke(api, "POST", "/thing/2/update", { title: "No", count: 1 }), AccessError);
    await assertRejects(() => invoke(api, "POST", "/thing/1/update", { title: "Bad", count: "x" }), ValidationError);
  });
});

Deno.test("apt: _checkAccess returns before input validation", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "POST", "/thing/1/update", { _checkAccess: "1" }), { ok: true });
  });
});

Deno.test("apt: toTools exposes path/input/query parameters", () => {
  const tools = toTools(api);
  const update = tools.find((tool) => tool.name === "post_thing_update");
  assertEquals(update?.description, "Update thing");
  assertEquals(update?.parameters, {
    type: "object",
    properties: {
      thing: { type: "number" },
      title: { type: "string" },
      count: { type: "number" },
      enabled: { type: "boolean" },
      preview: { type: "boolean" },
    },
    required: ["thing", "title", "count"],
  });
});

Deno.test("apt: aptClient mirrors the action tree", async () => {
  await withCtx(async () => {
    const client = aptClient(api);
    assertEquals(await client.thing(1).get(), { id: 1, title: "One" });
    assertEquals(await client.thing(1).update.post({ title: "Via RPC", count: 2 }), {
      id: 1,
      title: "Via RPC",
      count: 2,
      enabled: false,
      preview: false,
    });
    assertThrows(() => client.missing.get(), TypeError);
  });
});
