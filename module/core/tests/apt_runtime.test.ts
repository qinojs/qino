// deno-lint-ignore-file no-explicit-any
import { aptRequest, assertEquals, assertRejects, assertThrows } from "./deps.ts";
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
} from "../lib/apt/mod.ts";
import { RequestContext, requestStorage } from "../lib/RequestContext.ts";

const ctx = new RequestContext();
ctx.lang = "de";
let csrfToken = "csrf-token";
const token = (v?: string) => {
  if (v !== undefined) csrfToken = v;
  return csrfToken;
};
ctx.session = { liveUser: () => 0, qg: { token } } as any;

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

Deno.test("apt: invoke keeps input strict and coerces query fields", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "POST", "/thing/1/update", {
      input: {
        title: "New",
        count: 7,
        enabled: true,
      },
      query: {
        preview: "true",
      },
    }), {
      id: 1,
      title: "New",
      count: 7,
      enabled: true,
      preview: true,
    });
    assertEquals(await invoke(api, "POST", "/thing/1/update", {
      input: {
        title: "Off",
        count: 2,
      },
      query: {
        preview: "",
      },
    }), {
      id: 1,
      title: "Off",
      count: 2,
      enabled: false,
      preview: false,
    });
  });
});

Deno.test("apt: access and validation errors are typed", async () => {
  await withCtx(async () => {
    await assertRejects(() => invoke(api, "GET", "/thing/9"), NotFoundError);
    await assertRejects(() => invoke(api, "GET", "/thing/2kb"), ValidationError);
    await assertRejects(() => invoke(api, "GET", "/closed"), AccessError);
    await assertRejects(() => invoke(api, "POST", "/thing/2/update", { title: "No", count: 1 }), AccessError);
    await assertRejects(() => invoke(api, "POST", "/thing/1/update", { title: "Bad", count: "7" }), ValidationError);
    await assertRejects(() => invoke(api, "POST", "/thing/1/update", { input: { title: "Bad", count: 7 }, query: { preview: "yes" } }), ValidationError);
  });
});

Deno.test("apt: _checkAccess returns before input validation", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "POST", "/thing/1/update", { _checkAccess: "1" }), { ok: true });
  });
});

Deno.test("apt: GET query params are available as input", async () => {
  await withCtx(async () => {
    const tree = {
      search: {
        get: {
          access: Access.PUBLIC,
          input: s.object({ q: s.string() }),
          execute: ({ q }: any) => ({ q }),
        },
      },
    };
    const res = await aptRequest(tree, "/search?q=abc");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { q: "abc" });
  });
});

Deno.test("apt: mutations require same origin and qg token", async () => {
  await withCtx(async () => {
    const body = JSON.stringify({ title: "Two", count: 2 });

    const noCsrf = await aptRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assertEquals(noCsrf.status, 403);

    const badOrigin = await aptRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://evil.test", "x-csrf-token": csrfToken },
      body,
    });
    assertEquals(badOrigin.status, 403);

    const ok = await aptRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://qino.test", "x-csrf-token": csrfToken },
      body,
    });
    assertEquals(ok.status, 200);
    assertEquals(await ok.json(), { id: 1, title: "Two", count: 2, enabled: false, preview: false });
  });
});

Deno.test("apt: catchall params collect remaining path segments", async () => {
  await withCtx(async () => {
    const files = {
      file: {
        ":path*": {
          paramSchema: s.array(s.string()),
          get: {
            access: Access.PUBLIC,
            execute: ({ path }: any) => ({ path }),
          },
          put: {
            access: Access.PUBLIC,
            input: s.object({ value: s.any() }),
            execute: ({ path, value }: any) => ({ path, value }),
          },
          delete: {
            access: Access.PUBLIC,
            execute: ({ path }: any) => ({ path }),
          },
        },
      },
    };
    assertEquals(await invoke(files, "GET", "/file"), { path: [] });
    assertEquals(await invoke(files, "GET", "/file/a/b"), { path: ["a", "b"] });
    assertEquals(await (await aptRequest(files, "/file")).json(), { path: [] });
    assertEquals(await (await aptRequest(files, "/file/a/b")).json(), { path: ["a", "b"] });
    assertEquals(toTools(files)[0].parameters, {
      type: "object",
      properties: { path: { type: "array", items: { type: "string" } } },
      required: [],
    });
    assertEquals(await invoke(files, "PUT", "/file/a/b", { input: { value: 1 } }), { path: ["a", "b"], value: 1 });
    assertEquals(await invoke(files, "DELETE", "/file/a/b"), { path: ["a", "b"] });
    assertEquals(await toTools(files)[0].execute({ path: ["a/b", "+<\""] }, ctx), { path: ["a/b", "+<\""] });
    assertEquals(await aptClient(files).file.get(), { path: [] });
    assertEquals(await aptClient(files).file(["a/b", "+<\""]).get(), { path: ["a/b", "+<\""] });
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
