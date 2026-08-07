// deno-lint-ignore-file no-explicit-any
import { apiRequest, assertEquals, assertRejects, assertThrows, testContext } from "./deps.ts";
import { s } from "../lib/StandardSchema.ts";
import {
  Access,
  AccessError,
  NotFoundError,
  ValidationError,
  apiClient,
  invoke,
  camelName,
  toTools,
} from "../lib/api/mod.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

let csrfToken = "csrf-token";
const token = (v?: string) => {
  if (v !== undefined) csrfToken = v;
  return csrfToken;
};
const ctx = await testContext({ sess: { data: { core: { userId: () => 0, csrfToken: token } } } });
ctx.lang = "de";

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
          access: Access.PUBLIC,
          guard: ({ thing }: any) => thing.writable,
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

Deno.test("api: invoke resolves path params and validates output", async () => {
  await withCtx(async () => {
    assertEquals(await invoke(api, "GET", "/thing/1"), { id: 1, title: "One" });
  });
});

Deno.test("api: invoke keeps input strict and coerces query fields", async () => {
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

Deno.test("api: access and validation errors are typed", async () => {
  await withCtx(async () => {
    await assertRejects(() => invoke(api, "GET", "/thing/9"), NotFoundError);
    await assertRejects(() => invoke(api, "GET", "/thing/2kb"), ValidationError);
    await assertRejects(() => invoke(api, "GET", "/closed"), AccessError);
    await assertRejects(() => invoke(api, "POST", "/thing/2/update", { title: "No", count: 1 }), AccessError);
    await assertRejects(() => invoke(api, "POST", "/thing/1/update", { title: "Bad", count: "7" }), ValidationError);
    await assertRejects(() => invoke(api, "POST", "/thing/1/update", { input: { title: "Bad", count: 7 }, query: { preview: "yes" } }), ValidationError);
  });
});

Deno.test("api: checkAccess option returns before input validation", async () => {
  await withCtx(async () => {
    // invalid body would normally throw ValidationError; the gate returns first
    assertEquals(await invoke(api, "POST", "/thing/1/update", { title: "Bad", count: "x" }, { checkAccess: true }), { ok: true });
    // gate still runs: guard denies non-writable thing 2
    await assertRejects(() => invoke(api, "POST", "/thing/2/update", {}, { checkAccess: true }), AccessError);
    // a field named _checkAccess is now just data, no longer a control signal
    await assertRejects(() => invoke(api, "POST", "/thing/1/update", { _checkAccess: "1" }), ValidationError);
  });
});

Deno.test("api: X-Api-Check header triggers the access gate over HTTP", async () => {
  await withCtx(async () => {
    const res = await apiRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://qino.test", "x-csrf-token": csrfToken, "x-api-check": "access" },
      body: `{}`, // invalid input, but the gate answers before validation
    });
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  });
});

Deno.test("api: __proto__ body keys do not become inherited input", async () => {
  await withCtx(async () => {
    const res = await apiRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://qino.test", "x-csrf-token": csrfToken },
      body: `{"__proto__":{"_checkAccess":"1"}}`,
    });
    assertEquals(res.status, 422);
  });
});

Deno.test("api: GET query params are available as input", async () => {
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
    const res = await apiRequest(tree, "/search?q=abc");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { q: "abc" });
  });
});

Deno.test("api: mutations require same origin and csrf token", async () => {
  await withCtx(async () => {
    const body = JSON.stringify({ title: "Two", count: 2 });

    const noCsrf = await apiRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assertEquals(noCsrf.status, 403);

    const badOrigin = await apiRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://evil.test", "x-csrf-token": csrfToken },
      body,
    });
    assertEquals(badOrigin.status, 403);

    const ok = await apiRequest(api, "http://qino.test/thing/1/update", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://qino.test", "x-csrf-token": csrfToken },
      body,
    });
    assertEquals(ok.status, 200);
    assertEquals(await ok.json(), { id: 1, title: "Two", count: 2, enabled: false, preview: false });
  });
});

Deno.test("api: catchall params collect remaining path segments", async () => {
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
    assertEquals(await (await apiRequest(files, "/file")).json(), { path: [] });
    assertEquals(await (await apiRequest(files, "/file/a/b")).json(), { path: ["a", "b"] });
    assertEquals(toTools(files)[0].parameters, {
      type: "object",
      properties: { path: { type: "array", items: { type: "string" } } },
      required: [],
    });
    assertEquals(await invoke(files, "PUT", "/file/a/b", { input: { value: 1 } }), { path: ["a", "b"], value: 1 });
    assertEquals(await invoke(files, "DELETE", "/file/a/b"), { path: ["a", "b"] });
    assertEquals(await toTools(files)[0].execute({ path: ["a/b", "+<\""] }, ctx), { path: ["a/b", "+<\""] });
    assertEquals(await apiClient(files).file.get(), { path: [] });
    assertEquals(await apiClient(files).file(["a/b", "+<\""]).get(), { path: ["a/b", "+<\""] });
  });
});

Deno.test("api: toTools exposes path/input/query parameters", () => {
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

Deno.test("api: apiClient mirrors the action tree", async () => {
  await withCtx(async () => {
    const client = apiClient(api);
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

Deno.test("api: tool names stay within the MCP name charset", () => {
  assertEquals(camelName("get", ["cms.frontend.2", "widget"]), "get_cmsFrontend2_widget");
  assertEquals(camelName("post", ["cms.backend.superuser.oauth_server"]), "post_cmsBackendSuperuserOauth_server");
  assertEquals(camelName("delete", ["file-store.9", ":id"]), "delete_fileStore9");
  const tools = toTools({ "cms.frontend.2": { widget: { post: { execute: () => null } } } } as never);
  assertEquals(/^[a-zA-Z0-9_-]{1,64}$/.test(tools[0].name), true);
});
