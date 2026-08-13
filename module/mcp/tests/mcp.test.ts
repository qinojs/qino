import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { Access, Output, type Ctx, requestStorage, s, type Params } from "../../core/mod.ts";
import { mcpFetch } from "../mod.ts";

const apiTree = {
  hello: {
    get: { description: "say hello", access: Access.PUBLIC, input: s.object({ name: s.optional(s.string()) }), execute: (p: Params) => ({ msg: "hi " + (p.name ?? "") }) },
  },
  secret: {
    get: { description: "secret", access: Access.SUPERUSER, execute: () => "s" },
  },
};

async function makeCtx(body: unknown, { auth = true, method = "POST", oauth = false } = {}): Promise<Ctx> {
  const ctx = await testContext({
    url: "http://localhost/mcp",
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    app: {
      dev: true,
      db: { table: () => ({ row: (id: number) => id ? { superuser: 0 } : null }) },
      modules: { get: (name: string) => oauth && name === "oauth_server" ? {} : undefined },
      apiTree,
    },
  });
  if (auth) ctx.authenticate(1);
  return ctx;
}

/** mcpFetch always signals via thrown Output; capture and parse it. */
// deno-lint-ignore no-explicit-any
async function call(ctx: Ctx): Promise<{ status: number; body: any; headers: Headers }> {
  try {
    await requestStorage.run(ctx, () => mcpFetch(ctx));
  } catch (e) {
    if (e instanceof Output) return { status: e.status, body: typeof e.body === "string" ? JSON.parse(e.body) : undefined, headers: e.buildHeaders() };
    throw e;
  }
  throw new Error("expected Output");
}

const rpc = (method: string, params?: unknown, id: number | undefined = 1) => ({ jsonrpc: "2.0", id, method, params });

Deno.test("mcp: rejects unauthenticated requests", async () => {
  const res = await call(await makeCtx(rpc("tools/list"), { auth: false }));
  assertEquals(res.status, 401);
  assertEquals(res.body.error.code, -32001);
  assertEquals(res.headers.get("WWW-Authenticate"), "Bearer");
});

Deno.test("mcp: 401 advertises the resource metadata when oauth_server is installed", async () => {
  const res = await call(await makeCtx(rpc("tools/list"), { auth: false, oauth: true }));
  assertEquals(res.headers.get("WWW-Authenticate"), 'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"');
});

Deno.test("mcp: rejects non-POST", async () => {
  const res = await call(await makeCtx(undefined, { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("mcp: initialize negotiates protocol version", async () => {
  const res = await call(await makeCtx(rpc("initialize", { protocolVersion: "2025-03-26" })));
  assertEquals(res.status, 200);
  assertEquals(res.body.result.protocolVersion, "2025-03-26");
  assertEquals(res.body.result.capabilities, { tools: {} });
  const other = await call(await makeCtx(rpc("initialize", { protocolVersion: "1999-01-01" })));
  assertEquals(other.body.result.protocolVersion, "2025-06-18");
});

Deno.test("mcp: notifications get 202 without body", async () => {
  const res = await call(await makeCtx({ jsonrpc: "2.0", method: "notifications/initialized" }));
  assertEquals(res.status, 202);
});

Deno.test("mcp: tools/list is access-filtered", async () => {
  const res = await call(await makeCtx(rpc("tools/list")));
  // deno-lint-ignore no-explicit-any
  assertEquals(res.body.result.tools.map((t: any) => t.name), ["get_hello"]); // secret (SUPERUSER) filtered out
  assertEquals(res.body.result.tools[0].inputSchema, { type: "object", properties: { name: { type: "string" } }, required: [] });
});

Deno.test("mcp: tools/call executes and returns structured content", async () => {
  const res = await call(await makeCtx(rpc("tools/call", { name: "get_hello", arguments: { name: "qino" } })));
  assertEquals(res.body.result.structuredContent, { msg: "hi qino" });
  assertEquals(res.body.result.content, [{ type: "text", text: '{"msg":"hi qino"}' }]);
});

Deno.test("mcp: tools/call enforces access as tool error", async () => {
  const res = await call(await makeCtx(rpc("tools/call", { name: "get_secret" })));
  assertEquals(res.status, 200);
  assertEquals(res.body.result.isError, true);
});

Deno.test("mcp: unknown method and unknown tool", async () => {
  const res = await call(await makeCtx(rpc("nope")));
  assertEquals(res.body.error.code, -32601);
  const tool = await call(await makeCtx(rpc("tools/call", { name: "nope" })));
  assertEquals(tool.body.error.code, -32602);
});
